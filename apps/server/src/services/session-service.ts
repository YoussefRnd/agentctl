import { sessions, projects, type db as defaultDb } from '@agentctl/core/db';
import { eq } from 'drizzle-orm';
import { AppError } from '../errors/app-error.js';
import type { SessionManager } from '@agentctl/core/session';
import type { WorktreeManager } from '@agentctl/core/git';
import type { ProviderRegistry } from '@agentctl/core/providers';
import type { FastifyBaseLogger } from 'fastify';
import { type SessionMode, sessionRowSchema, type SessionRow } from '@agentctl/shared';

export class SessionService {
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

  async createSession(params: {
    projectId: string;
    providerId?: string;
    taskSlug: string;
    mode?: SessionMode;
  }) {
    const session = await this.sessionManager.createSession(params);

    const sessionRecord = await this.db.query.sessions.findFirst({
      where: eq(sessions.id, session.sessionId),
      with: { project: true },
    });

    if (!sessionRecord) {
      throw new AppError('Failed to retrieve created session', 500);
    }

    return this.parseSessionRow(sessionRecord);
  }

  async getSessionWithCapabilities(sessionId: string) {
    const session = await this.db.query.sessions.findFirst({
      where: eq(sessions.id, sessionId),
      with: { project: true },
    });

    if (!session) {
      throw new AppError('Session not found', 404);
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
      const eventStore = this.sessionManager.getEventStore();
      await eventStore.recalculateTotalTokens(sessionId).catch(() => undefined);
      const refreshed = await this.db.query.sessions.findFirst({
        where: eq(sessions.id, sessionId),
        with: { project: true },
      });
      if (refreshed && refreshed.totalTokens > 0) {
        session.totalTokens = refreshed.totalTokens;
      }
    }

    const providersList = await this.providerRegistry.discover();
    return {
      session: this.parseSessionRow(session),
      capabilities: providersList,
    };
  }

  async updateSessionProvider(
    sessionId: string,
    config: {
      selectedProvider: string;
      selectedModel: string;
      selectedThinkingEffort: 'low' | 'medium' | 'high';
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

    if (!project?.repoRoot) {
      return [];
    }

    return await this.worktreeManager.listBranches(project.repoRoot);
  }

  async checkoutBranch(sessionId: string, branchName: string) {
    const session = await this.db.query.sessions.findFirst({
      where: eq(sessions.id, sessionId),
      with: { project: true },
    });

    if (!session) {
      throw new AppError('Session not found', 404);
    }

    if (!session.project.repoRoot) {
      throw new AppError('Project is not a git repository', 400);
    }

    // Always use a git worktree for branch switching, never checkout in-place on
    // the project directory. This avoids changing source files under a running dev
    // server (which would trigger a tsx watch restart and crash the app).
    //
    // addBranchWorktree recreates the session's worktree via git worktree add --force,
    // which allows the branch to be checked out even if it's currently active in the
    // main project directory (commits from either location go to the same branch).

    const worktree = await this.worktreeManager.addBranchWorktree(
      session.project.repoRoot,
      sessionId,
      branchName,
      session.project.subdir,
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
    const activeSession = this.sessionManager.getSession(sessionId);
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

  async finalizeSession(sessionId: string, action: 'merge' | 'discard', commitMessage?: string) {
    const session = await this.db.query.sessions.findFirst({
      where: eq(sessions.id, sessionId),
    });

    if (!session) {
      throw new AppError('Session not found', 404);
    }

    try {
      await this.sessionManager.finalizeSession(sessionId, action, commitMessage);
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
    await this.sessionManager.restartSession(sessionId);
  }

  async cancelSession(sessionId: string) {
    const session = this.sessionManager.getSession(sessionId);
    if (session) {
      await session.cancel();
    }
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

  async previewSnapshotDiff(sessionId: string, eventId: number) {
    return await this.sessionManager.previewSnapshotDiff(sessionId, eventId);
  }

  async restoreSnapshot(sessionId: string, snapshotHash: string) {
    return await this.sessionManager.restoreSnapshot(sessionId, snapshotHash);
  }

  async mergeSessionBranch(sessionId: string, otherBranchName: string) {
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
      return { canMerge: true, hasConflicts: false, conflictingFiles: [] };
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
    void this.sessionManager
      .handleClientMessage(created.sessionId, 'session.input', {
        input: params.prompt,
      })
      .catch((err: unknown) => {
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

  spawnSwarmSubagent = this.spawnParallelAgent;

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
      await activeSession.eventStore.append(
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

  respondToElicitation(
    sessionId: string,
    elicitationId: string,
    response: { action: 'submit' | 'cancel'; values?: Record<string, unknown> },
  ) {
    const activeSession = this.sessionManager.getSession(sessionId);
    if (!activeSession) {
      throw new AppError('Active session not found', 404);
    }
    const ok = activeSession.respondToElicitation(elicitationId, response);
    if (!ok) {
      throw new AppError('Elicitation not found or already completed', 400);
    }
  }

  getSnapshotService() {
    return this.sessionManager.getSnapshotService();
  }
}
