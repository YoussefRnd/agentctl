import { canMutateWorkspace } from '@agentctl/shared';
import {
  sessions,
  sessionEvents,
  projects,
  nativeSessionImports,
  type db as defaultDb,
} from '@agentctl/core/db';
import { and, eq, sql } from 'drizzle-orm';
import { AppError } from '../errors/app-error.js';
import { refreshProjectRepository } from './project-repository.js';
import type { SessionManager } from '@agentctl/core/session';
import type { WorktreeManager } from '@agentctl/core/git';
import type { ProviderRegistry } from '@agentctl/core/providers';
import type { FastifyBaseLogger } from 'fastify';
import {
  type HandoffSessionResponse,
  type ElicitationResponse,
  type SessionMode,
  sessionRowSchema,
  type SessionRow,
  type ThinkingEffort,
} from '@agentctl/shared';

export class SessionService {
  private nativeImports = new Map<string, Promise<{ sessionId: string }>>();

  importNativeSession(params: {
    projectId: string;
    providerId: string;
    nativeSessionId: string;
    title?: string;
  }): Promise<{ sessionId: string }> {
    const key = JSON.stringify([params.projectId, params.providerId, params.nativeSessionId]);
    const pending = this.nativeImports.get(key);
    if (pending) return pending;
    const operation = this.doImportNativeSession(params);
    this.nativeImports.set(key, operation);
    void operation.finally(() => this.nativeImports.delete(key)).catch(() => undefined);
    return operation;
  }

  private async doImportNativeSession(params: {
    projectId: string;
    providerId: string;
    nativeSessionId: string;
    title?: string;
  }): Promise<{ sessionId: string }> {
    const identity = and(
      eq(nativeSessionImports.projectId, params.projectId),
      eq(nativeSessionImports.providerId, params.providerId),
      eq(nativeSessionImports.nativeSessionId, params.nativeSessionId),
    );
    let imported = this.db.select().from(nativeSessionImports).where(identity).get();
    if (imported?.completed) return { sessionId: imported.sessionId };
    const provider = await this.providerRegistry.ensureProviderReady(params.providerId);
    if (!provider.features.sessions.resume)
      throw new AppError('Agent does not support native session loading', 400);
    if (!imported) {
      const created = await this.createSession({
        projectId: params.projectId,
        providerId: params.providerId,
        taskSlug: 'imported-session',
        mode: 'local',
      });
      this.db.transaction((tx) => {
        tx.update(sessions)
          .set({
            agentSessionId: JSON.stringify({ [params.providerId]: params.nativeSessionId }),
            title: params.title?.trim() || 'Imported session',
          })
          .where(eq(sessions.id, created.id))
          .run();
        tx.insert(nativeSessionImports)
          .values({ ...params, sessionId: created.id })
          .run();
      });
      imported = this.db.select().from(nativeSessionImports).where(identity).get()!;
    }
    try {
      await this.sessionManager.stopSessionAndWait(imported.sessionId);
      // A previous interrupted load can be retried without duplicating partial history.
      this.db.transaction((tx) => {
        tx.delete(sessionEvents).where(eq(sessionEvents.sessionId, imported.sessionId)).run();
        tx.update(sessions)
          .set({ plan: '[]', planArtifacts: '[]' })
          .where(eq(sessions.id, imported.sessionId))
          .run();
      });
      const loaded = await this.sessionManager.restartSession(imported.sessionId, {
        nativeImport: true,
      });
      await loaded.flushAll();
      if (loaded.isDead || loaded.requiresHistoryContext)
        throw new AppError('The native session could not be restored', 400);
      this.db.update(nativeSessionImports).set({ completed: true }).where(identity).run();
      return { sessionId: imported.sessionId };
    } catch (error) {
      await this.sessionManager.stopSessionAndWait(imported.sessionId);
      this.db
        .update(sessions)
        .set({ status: 'error' })
        .where(eq(sessions.id, imported.sessionId))
        .run();
      throw error;
    }
  }

  constructor(
    private db: typeof defaultDb,
    private sessionManager: SessionManager,
    private worktreeManager: WorktreeManager,
    private providerRegistry: ProviderRegistry,
    private log: FastifyBaseLogger,
  ) {}

  private parseSessionRow(raw: unknown): SessionRow {
    return sessionRowSchema.parse(raw);
  }

  private async hasUserActivity(sessionId: string): Promise<boolean> {
    const rows = await this.db
      .select({ id: sessionEvents.id })
      .from(sessionEvents)
      .where(
        and(
          eq(sessionEvents.sessionId, sessionId),
          eq(sessionEvents.type, 'text'),
          sql`json_extract(${sessionEvents.data}, '$.role') = 'user'`,
        ),
      )
      .limit(1);
    return rows.length > 0;
  }

  async createSession(params: {
    projectId: string;
    providerId?: string;
    taskSlug: string;
    mode?: SessionMode;
    selectedModel?: string;
    selectedThinkingEffort?: ThinkingEffort;
    approvalMode?: 'review' | 'auto_approve' | 'yolo';
    agentPersona?: string;
  }) {
    const session = await this.sessionManager.createSession(params);

    const sessionRecord = await this.db.query.sessions.findFirst({
      where: eq(sessions.id, session.sessionId),
      with: { project: true },
    });

    if (!sessionRecord) {
      throw new AppError('Failed to retrieve created session', 500);
    }

    return this.parseSessionRow({ ...sessionRecord, hasUserActivity: false });
  }

  async getSessionWithCapabilities(sessionId: string) {
    const session = await this.db.query.sessions.findFirst({
      where: eq(sessions.id, sessionId),
      with: { project: true },
    });

    if (!session) {
      throw new AppError('Session not found', 404);
    }

    if (session.mode === 'worktree') {
      await this.sessionManager.ensureWorkspaceAvailable(sessionId);
    }

    if (session.project.repoRoot && session.worktreePath === session.project.path) {
      const currentBranch = await this.worktreeManager
        .getCurrentBranch(session.worktreePath)
        .catch(() => null);
      if (currentBranch !== null && currentBranch !== session.branch) {
        const snapshotService = this.sessionManager.getSnapshotService();
        const treeHash = await snapshotService.track(session.worktreePath).catch(() => undefined);
        const newBaseCommit = treeHash ?? session.baseCommit;
        await this.db
          .update(sessions)
          .set({ branch: currentBranch, baseCommit: newBaseCommit })
          .where(eq(sessions.id, sessionId));
        session.branch = currentBranch;
        session.baseCommit = newBaseCommit;
      }
    }

    if (session.totalTokens <= 0) {
      const eventRepository = this.sessionManager.getEventRepository();
      await eventRepository.recalculateTotalTokens(sessionId).catch(() => undefined);
      const refreshed = await this.db.query.sessions.findFirst({
        where: eq(sessions.id, sessionId),
        with: { project: true },
      });
      if (refreshed && refreshed.totalTokens > 0) {
        session.totalTokens = refreshed.totalTokens;
      }
    }

    if (session.contextLimit <= 0 && session.sessionMetrics) {
      try {
        const parsed = JSON.parse(session.sessionMetrics) as { contextLimit?: number };
        if (typeof parsed.contextLimit === 'number' && parsed.contextLimit > 0) {
          await this.db
            .update(sessions)
            .set({ contextLimit: parsed.contextLimit })
            .where(eq(sessions.id, sessionId));
          session.contextLimit = parsed.contextLimit;
        }
      } catch {
        // ignore
      }
    }

    const providersList = await this.providerRegistry.discover();
    return {
      session: this.parseSessionRow({
        ...session,
        hasUserActivity: await this.hasUserActivity(sessionId),
      }),
      capabilities: providersList,
    };
  }

  async updateSessionProvider(
    sessionId: string,
    config: {
      selectedProvider: string;
      selectedModel: string;
      selectedThinkingEffort?: ThinkingEffort;
    },
  ) {
    const session = await this.db.query.sessions.findFirst({
      where: eq(sessions.id, sessionId),
    });

    if (!session) {
      throw new AppError('Session not found', 404);
    }

    await this.sessionManager.updateSessionConfig(sessionId, config);

    const updatedSession = await this.db.query.sessions.findFirst({
      where: eq(sessions.id, sessionId),
    });

    if (!updatedSession) {
      throw new AppError('Session not found', 404);
    }

    const providersList = await this.providerRegistry.discover();
    return {
      session: this.parseSessionRow(updatedSession),
      capabilities: providersList,
    };
  }

  async listBranches(sessionId: string) {
    const session = await this.db.query.sessions.findFirst({
      where: eq(sessions.id, sessionId),
      with: { project: true },
    });

    if (!session) {
      throw new AppError('Session not found', 404);
    }

    const project = await this.db.query.projects.findFirst({
      where: eq(projects.id, session.projectId),
    });

    if (!project) throw new AppError('Project not found', 404);
    const resolved = await refreshProjectRepository(this.db, this.worktreeManager, project);
    if (!resolved.repoRoot) return [];
    return await this.worktreeManager.listBranches(resolved.repoRoot);
  }

  async checkoutBranch(sessionId: string, branchName: string, create = false) {
    return this.sessionManager.runWorkspaceCommand(
      sessionId,
      { action: 'checkout', branchName, create },
      () => this.checkoutBranchInLane(sessionId, branchName, create),
    );
  }

  private async checkoutBranchInLane(sessionId: string, branchName: string, create: boolean) {
    const session = await this.db.query.sessions.findFirst({
      where: eq(sessions.id, sessionId),
      with: { project: true },
    });

    if (!session) {
      throw new AppError('Session not found', 404);
    }

    if (!canMutateWorkspace(session.status)) {
      throw new AppError('Stop the active turn before changing branches', 400);
    }
    const project = await refreshProjectRepository(this.db, this.worktreeManager, session.project);
    if (!project.repoRoot) throw new AppError('Project is not a Git repository', 400);
    if (create) {
      await this.worktreeManager.createBranch(project.repoRoot, session.worktreePath, branchName);
      await this.db.update(sessions).set({ branch: branchName }).where(eq(sessions.id, sessionId));
      return this.parseSessionRow(
        await this.db.query.sessions.findFirst({ where: eq(sessions.id, sessionId) }),
      );
    }
    if (!(await this.worktreeManager.isCleanWorkspace(project.repoRoot, session.worktreePath))) {
      throw new AppError('Commit or stash changes before switching branches', 400);
    }
    const activeSession = this.sessionManager.getSession(sessionId);
    this.sessionManager.stopSession(sessionId);
    const worktree = await this.worktreeManager.addBranchWorktree(
      project.repoRoot,
      sessionId,
      branchName,
      project.subdir,
      undefined,
      session.mode === 'worktree' ? session.worktreePath : undefined,
    );

    // Snapshot the new state
    const snapshotService = this.sessionManager.getSnapshotService();
    const treeHash = await snapshotService.track(worktree.workspacePath).catch(() => undefined);
    const baseCommit = treeHash ?? 'none';

    await this.db
      .update(sessions)
      .set({
        mode: 'worktree',
        worktreePath: worktree.workspacePath,
        branch: branchName,
        baseCommit,
      })
      .where(eq(sessions.id, sessionId));

    // Restart session in the worktree if active, so the agent picks up the new path
    if (activeSession) {
      const provider = await this.providerRegistry.ensureProviderReady(session.selectedProvider, {
        force: false,
      });
      if (provider.isReady || provider.needsAuth) {
        await this.sessionManager.restartSession(sessionId);
      }
    }

    const updatedSession = await this.db.query.sessions.findFirst({
      where: eq(sessions.id, sessionId),
      with: { project: true },
    });
    if (!updatedSession) throw new AppError('Session not found', 500);
    return this.parseSessionRow(updatedSession);
  }

  async switchMode(sessionId: string, mode: SessionMode) {
    const session = await this.db.query.sessions.findFirst({
      where: eq(sessions.id, sessionId),
      with: { project: true },
    });

    if (!session) {
      throw new AppError('Session not found', 404);
    }

    await this.sessionManager.switchMode(sessionId, mode);

    const updatedSession = await this.db.query.sessions.findFirst({
      where: eq(sessions.id, sessionId),
      with: { project: true },
    });

    if (!updatedSession) {
      throw new AppError('Session not found', 404);
    }

    return this.parseSessionRow(updatedSession);
  }

  async updateApprovalMode(sessionId: string, approvalMode: string) {
    const session = await this.db.query.sessions.findFirst({
      where: eq(sessions.id, sessionId),
    });

    if (!session) {
      throw new AppError('Session not found', 404);
    }

    await this.sessionManager.updateApprovalMode(sessionId, approvalMode);

    const updatedSession = await this.db.query.sessions.findFirst({
      where: eq(sessions.id, sessionId),
    });

    if (!updatedSession) {
      throw new AppError('Session not found', 404);
    }

    return this.parseSessionRow(updatedSession);
  }

  async finalizeSession(
    sessionId: string,
    action: 'merge' | 'discard',
    commitMessage?: string,
    targetBranch?: string,
  ) {
    const session = await this.db.query.sessions.findFirst({
      where: eq(sessions.id, sessionId),
    });

    if (!session) {
      throw new AppError('Session not found', 404);
    }

    if (targetBranch && session.mode !== 'worktree')
      throw new AppError('Destination branches apply only to worktree sessions', 400);
    try {
      await this.sessionManager.finalizeSession(sessionId, action, commitMessage, targetBranch);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      if (
        message.includes('Merge conflict') ||
        message.includes('Working tree is not clean') ||
        message.includes('sandbox')
      ) {
        throw new AppError(message, 400);
      }
      throw err;
    }

    const updatedSession = await this.db.query.sessions.findFirst({
      where: eq(sessions.id, sessionId),
      with: { project: true },
    });

    if (!updatedSession) {
      throw new AppError('Session not found after finalization', 500);
    }

    return this.parseSessionRow(updatedSession);
  }

  async deleteSession(sessionId: string) {
    await this.sessionManager.deleteSession(sessionId);
  }

  async archiveSession(sessionId: string) {
    await this.sessionManager.archiveSession(sessionId);
  }

  async restartSession(sessionId: string) {
    await this.sessionManager.reconnectSession(sessionId);
  }

  async cancelSession(sessionId: string) {
    await this.sessionManager.handleClientMessage(sessionId, 'cancel', {});
  }

  writeTerminalInput(sessionId: string, terminalId: string, data: string): boolean {
    return this.sessionManager.writeTerminalInput(sessionId, terminalId, data);
  }

  async rewindSession(sessionId: string, eventId: number, mode: 'conversation' | 'files' | 'fork') {
    return await this.sessionManager.rewindSession(sessionId, eventId, mode);
  }

  async undoRewind(sessionId: string) {
    return await this.sessionManager.undoRewind(sessionId);
  }

  async handoffSession(
    sessionId: string,
    targetProvider: string,
    targetModel?: string,
    nextSessionFocus?: string,
  ): Promise<HandoffSessionResponse> {
    try {
      return await this.sessionManager.handoffSession(
        sessionId,
        targetProvider,
        targetModel,
        nextSessionFocus,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to handoff session';
      if (message.startsWith('Session not found:')) {
        throw new AppError(message, 404);
      }
      if (
        message.includes('current agent turn') ||
        message.includes('source agent started another turn') ||
        message.includes('already using provider')
      ) {
        throw new AppError(message, 409);
      }
      throw error;
    }
  }

  async previewSnapshotDiff(sessionId: string, eventId: number) {
    return await this.sessionManager.previewSnapshotDiff(sessionId, eventId);
  }

  async restoreSnapshot(sessionId: string, snapshotHash: string) {
    return await this.sessionManager.restoreSnapshot(sessionId, snapshotHash);
  }

  async mergeSessionBranch(sessionId: string, otherBranchName: string) {
    return this.sessionManager.runWorkspaceCommand(
      sessionId,
      { action: 'merge_branch', otherBranchName },
      () => this.mergeSessionBranchInLane(sessionId, otherBranchName),
    );
  }

  private async mergeSessionBranchInLane(sessionId: string, otherBranchName: string) {
    const session = await this.db.query.sessions.findFirst({
      where: eq(sessions.id, sessionId),
      with: { project: true },
    });

    if (!session) {
      throw new AppError('Session not found', 404);
    }

    try {
      const project = session.project;
      if (!project.repoRoot) {
        throw new AppError('Project repo root is not configured', 400);
      }
      await this.worktreeManager.merge(project.repoRoot, session.worktreePath, otherBranchName);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      throw new AppError(`Merge failed: ${message}. There may be merge conflicts.`, 400);
    }
  }

  async checkMergeBranch(sessionId: string, otherBranchName: string) {
    const session = await this.db.query.sessions.findFirst({
      where: eq(sessions.id, sessionId),
      with: { project: true },
    });

    if (!session) {
      throw new AppError('Session not found', 404);
    }

    const project = session.project;
    if (!project.repoRoot) {
      throw new AppError('Project repo root is not configured', 400);
    }

    const result = await this.worktreeManager.checkMergeConflicts(
      project.repoRoot,
      session.worktreePath,
      otherBranchName,
    );

    return {
      canMerge: !result.hasConflicts,
      hasConflicts: result.hasConflicts,
      conflictingFiles: result.conflictingFiles,
    };
  }

  async spawnParallelAgent(
    parentSessionId: string,
    params: {
      prompt: string;
      title?: string;
      taskSlug?: string;
      providerId?: string;
      modelId?: string;
    },
  ) {
    const parentSession = await this.db.query.sessions.findFirst({
      where: eq(sessions.id, parentSessionId),
      with: { project: true },
    });

    if (!parentSession) {
      throw new AppError('Parent session not found', 404);
    }

    const randomSuffix = Math.random().toString(36).substring(2, 7);
    const taskSlug = params.taskSlug || `agent-${randomSuffix}`;
    const title = params.title || `Agent: ${params.prompt.slice(0, 40).trim()}`;

    // Create session in worktree mode
    const created = await this.sessionManager.createSession({
      projectId: parentSession.projectId,
      taskSlug,
      providerId: params.providerId ?? parentSession.selectedProvider ?? undefined,
      mode: 'worktree',
    });

    // Update title
    await this.db
      .update(sessions)
      .set({ title, updatedAt: new Date() })
      .where(eq(sessions.id, created.sessionId));

    // Send initial prompt input to subagent
    void this.sessionManager.startInput(created.sessionId, params.prompt).catch((err: unknown) => {
      this.log.error({ err, sessionId: created.sessionId }, 'Failed to send prompt to subagent');
    });

    const sessionRecord = await this.db.query.sessions.findFirst({
      where: eq(sessions.id, created.sessionId),
      with: { project: true },
    });

    if (!sessionRecord) {
      throw new AppError('Failed to retrieve spawned subagent session', 500);
    }

    return this.parseSessionRow(sessionRecord);
  }

  async renameSession(sessionId: string, title: string) {
    const session = await this.db.query.sessions.findFirst({
      where: eq(sessions.id, sessionId),
    });

    if (!session) {
      throw new AppError('Session not found', 404);
    }

    await this.db
      .update(sessions)
      .set({ title, updatedAt: new Date() })
      .where(eq(sessions.id, sessionId));

    const activeSession = this.sessionManager.getSession(sessionId);
    if (activeSession) {
      await activeSession.eventRepository.append(
        sessionId,
        'status',
        {
          status: 'session_info_update',
          title,
          updatedAt: new Date().toISOString(),
        },
        null,
      );
    }
  }

  respondToElicitation(sessionId: string, elicitationId: string, response: ElicitationResponse) {
    const activeSession = this.sessionManager.getSession(sessionId);
    if (!activeSession) {
      throw new AppError('Active session not found', 404);
    }
    let ok: boolean;
    try {
      ok = activeSession.respondToElicitation(elicitationId, response);
    } catch (error) {
      throw new AppError(
        error instanceof Error ? error.message : 'Invalid elicitation response',
        400,
      );
    }
    if (!ok) {
      throw new AppError('Elicitation not found or already completed', 400);
    }
  }

  getSnapshotService() {
    return this.sessionManager.getSnapshotService();
  }
}
