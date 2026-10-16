import {
  canMutateWorkspace,
  NEW_SESSION_TITLE,
  type SessionMode,
  type ThinkingEffort,
} from '@agentctl/shared';
import { eq, and, asc } from 'drizzle-orm';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import type { DbClient } from '../db/index.js';
import { sessions, projects, sessionEvents } from '../db/schema.js';
import type { RepositoryService } from '../repository/repository-service.js';
import type { SourceRepository } from '../repository/source-repository.js';
import type { WorkspaceBinding } from '../repository/workspace.js';

export type WorkspaceTargetState = 'active' | 'archived' | 'finalized';
export type FinalizeResolution = 'merged' | 'discarded';
export interface EstablishOptions {
  selectedProvider: string;
  selectedModel: string;
  mode?: SessionMode;
  agent?: string;
  selectedThinkingEffort?: ThinkingEffort;
  contextLimit?: number;
  sessionConfigOptions?: string;
  title?: string;
  approvalMode?: 'review' | 'auto_approve' | 'yolo';
  agentPersona?: string;
  availableAgentPersonas?: string[];
  dbTx?: unknown;
}
export interface TransitionOptions {
  mode?: SessionMode;
  resolution?: FinalizeResolution;
  commitMessage?: string;
  baseBranch?: string;
  taskSlug?: string;
  dbTx?: unknown;
}
export interface WorkspaceContext {
  sessionId: string;
  projectId: string;
  worktreePath: string;
  branch: string;
  mode: SessionMode;
  baseCommit: string;
  baseBranch: string | null;
}
export interface WorkspaceHandle {
  readonly path: string;
  readonly branch: string;
  readonly baseCommit: string;
  getDiff(): Promise<string>;
  getReviewFiles(): Promise<import('@agentctl/shared').ReviewFile[]>;
  stageFile(filePath: string): Promise<void>;
  revertFile(filePath: string): Promise<void>;
}
export class WorkspaceUnavailableError extends Error {
  readonly statusCode = 409;
}

/** Session persistence and lifecycle policy; backend mechanisms are capability operations. */
export class SessionWorkspace {
  private readonly availabilityChecks = new Map<string, Promise<boolean>>();
  constructor(
    private readonly db: DbClient,
    private readonly repositories: Pick<RepositoryService, 'open'>,
    private readonly stopSessionFn: (sessionId: string) => Promise<void> | void,
    private readonly onEvent?: (event: string, payload: Record<string, unknown>) => void,
  ) {}
  private binding(session: typeof sessions.$inferSelect): WorkspaceBinding {
    return {
      sessionId: session.id,
      path: session.worktreePath,
      label: session.branch,
      isolated: session.mode === 'worktree',
      baseline: session.baseCommit === 'none' ? undefined : session.baseCommit,
      target: session.baseBranch ?? undefined,
    };
  }
  private async capture(repository: SourceRepository): Promise<string> {
    return repository.info.capabilities.checkpoints ? repository.capture() : 'none';
  }
  async establish(
    projectId: string,
    taskSlug: string,
    options: EstablishOptions,
  ): Promise<WorkspaceContext> {
    const client = (options.dbTx ?? this.db) as DbClient;
    const project = await client.query.projects.findFirst({ where: eq(projects.id, projectId) });
    if (!project) throw new Error(`Project not found: ${projectId}`);
    const repository = await this.repositories.open(project.path);
    const sessionId = crypto.randomUUID();
    let mode = options.mode ?? (repository.info.capabilities.isolation ? 'worktree' : 'local');
    let branch = await repository.localLabel();
    let worktreePath = project.path,
      baseCommit = 'none',
      baseBranch: string | null = null;
    if (mode === 'worktree') {
      const allocation = await repository.allocateWorkspace({ sessionId, title: taskSlug });
      if (allocation) {
        worktreePath = allocation.path;
        branch = allocation.label;
        baseCommit = allocation.baseline;
        baseBranch = allocation.target ?? null;
      } else mode = 'local';
    }
    if (mode === 'local') baseCommit = await this.capture(repository);
    await client.insert(sessions).values({
      id: sessionId,
      projectId,
      branch,
      worktreePath,
      agent: options.agent ?? options.selectedProvider,
      status: 'idle',
      taskSlug,
      baseCommit,
      baseBranch,
      mode,
      selectedProvider: options.selectedProvider,
      selectedModel: options.selectedModel,
      selectedThinkingEffort: options.selectedThinkingEffort ?? null,
      contextLimit: options.contextLimit ?? 0,
      sessionConfigOptions: options.sessionConfigOptions ?? '[]',
      title: options.title ?? NEW_SESSION_TITLE,
      approvalMode: options.approvalMode ?? 'review',
      agentPersona: options.agentPersona,
      availableAgentPersonas: JSON.stringify(options.availableAgentPersonas ?? []),
    });
    this.onEvent?.('workspace:established', { sessionId, mode, path: worktreePath });
    return { sessionId, projectId, worktreePath, branch, mode, baseCommit, baseBranch };
  }
  async ensureAvailable(sessionId: string): Promise<boolean> {
    const pending = this.availabilityChecks.get(sessionId);
    if (pending) return pending;
    const check = this.restoreMissingWorkspace(sessionId);
    this.availabilityChecks.set(sessionId, check);
    try {
      return await check;
    } finally {
      this.availabilityChecks.delete(sessionId);
    }
  }
  private async restoreMissingWorkspace(sessionId: string): Promise<boolean> {
    const session = await this.db.query.sessions.findFirst({
      where: eq(sessions.id, sessionId),
      with: { project: true },
    });
    if (
      !session ||
      session.mode !== 'worktree' ||
      ['archived', 'merged', 'discarded'].includes(session.status)
    )
      return false;
    if (
      (
        await fs.stat(session.worktreePath).catch((error: NodeJS.ErrnoException) => {
          if (error.code !== 'ENOENT') throw error;
          return null;
        })
      )?.isDirectory()
    )
      return false;
    await this.stopSessionFn(sessionId);
    await this.restoreAllocation(session);
    this.onEvent?.('workspace:restored', { sessionId, path: session.worktreePath });
    return true;
  }
  private async restoreAllocation(
    session: typeof sessions.$inferSelect & { project: typeof projects.$inferSelect },
  ) {
    const messages = await this.db
      .select({ id: sessionEvents.id })
      .from(sessionEvents)
      .where(and(eq(sessionEvents.sessionId, session.id), eq(sessionEvents.type, 'text')));
    try {
      const repository = await this.repositories.open(session.project.path);
      await repository.restoreWorkspace(this.binding(session), messages.length === 0);
    } catch (error) {
      throw new WorkspaceUnavailableError(error instanceof Error ? error.message : String(error));
    }
  }
  async activate(sessionId: string, options?: TransitionOptions): Promise<WorkspaceContext> {
    const client = (options?.dbTx ?? this.db) as DbClient;
    const session = await client.query.sessions.findFirst({
      where: eq(sessions.id, sessionId),
      with: { project: true },
    });
    if (!session) throw new Error(`Session not found: ${sessionId}`);
    await this.stopSessionFn(sessionId);
    const repository = await this.repositories.open(session.project.path);
    const mode = options?.mode ?? session.mode;
    let worktreePath = session.worktreePath,
      branch = session.branch,
      baseCommit = session.baseCommit,
      baseBranch = session.baseBranch;
    if (mode === 'worktree' && session.mode === 'worktree') {
      if (!(await fs.stat(worktreePath).catch(() => null))?.isDirectory())
        await this.restoreAllocation(session);
    } else if (mode === 'local' && session.mode === 'local' && session.status === 'archived') {
      // Retained local archives keep their original checkpoint and staging, just like isolated ones.
    } else if (mode === 'worktree') {
      const allocation = await repository.allocateWorkspace({
        sessionId,
        title: options?.taskSlug ?? session.taskSlug,
        target: options?.baseBranch,
      });
      if (!allocation) throw new Error('Isolated workspace allocation is unavailable');
      worktreePath = allocation.path;
      branch = allocation.label;
      baseCommit = allocation.baseline;
      baseBranch = allocation.target ?? null;
    } else {
      if (session.mode === 'worktree')
        await repository.retireWorkspace(this.binding(session), true);
      worktreePath = session.project.path;
      branch = await repository.localLabel();
      baseCommit = await this.capture(repository);
      baseBranch = null;
    }
    await client
      .update(sessions)
      .set({
        mode,
        status: 'idle',
        worktreePath,
        branch,
        baseCommit,
        baseBranch,
        updatedAt: new Date(),
      })
      .where(eq(sessions.id, sessionId));
    this.onEvent?.('workspace:activated', { sessionId, path: worktreePath });
    return {
      sessionId,
      projectId: session.projectId,
      worktreePath,
      branch,
      mode,
      baseCommit,
      baseBranch,
    };
  }
  async archive(sessionId: string, options?: { dbTx?: unknown }): Promise<void> {
    const client = (options?.dbTx ?? this.db) as DbClient;
    if (!(await client.query.sessions.findFirst({ where: eq(sessions.id, sessionId) })))
      throw new Error(`Session not found: ${sessionId}`);
    await this.stopSessionFn(sessionId);
    await client
      .update(sessions)
      .set({ status: 'archived', updatedAt: new Date() })
      .where(eq(sessions.id, sessionId));
    this.onEvent?.('workspace:archived', { sessionId });
  }
  async finalize(
    sessionId: string,
    resolution: FinalizeResolution,
    options?: TransitionOptions,
  ): Promise<void> {
    const client = (options?.dbTx ?? this.db) as DbClient;
    const session = await client.query.sessions.findFirst({
      where: eq(sessions.id, sessionId),
      with: { project: true },
    });
    if (!session) throw new Error(`Session not found: ${sessionId}`);
    if (!canMutateWorkspace(session.status))
      throw new Error('Stop the active turn before finalizing an idle session');
    await this.stopSessionFn(sessionId);
    const repository = await this.repositories.open(session.project.path);
    const metadata = repository.legacyProjectMetadata;
    if (
      metadata &&
      (session.project.repoRoot !== metadata.repoRoot || session.project.subdir !== metadata.subdir)
    )
      await client.update(projects).set(metadata).where(eq(projects.id, session.projectId));
    let discardBackup: string | null = null;
    try {
      const binding = this.binding(session);
      if (resolution === 'discarded' && !binding.baseline) {
        const events = await client
          .select()
          .from(sessionEvents)
          .where(eq(sessionEvents.sessionId, sessionId))
          .orderBy(asc(sessionEvents.id));
        for (const event of events) {
          try {
            const metadata =
              typeof event.metadata === 'string' ? JSON.parse(event.metadata) : event.metadata;
            if (typeof metadata?.snapshotHash === 'string') {
              binding.baseline = metadata.snapshotHash;
              break;
            }
          } catch {
            /* Historical malformed metadata does not establish a baseline. */
          }
        }
      }
      if (resolution === 'discarded') {
        discardBackup = await repository.discardWorkspace(binding);
      } else {
        const target = options?.baseBranch ?? session.baseBranch ?? undefined;
        if (binding.isolated && target && target !== session.baseBranch) {
          const preview = await repository.previewIntegration(binding, target);
          if (preview.hasMergeHead)
            throw new Error(
              `Finish or abort the pending merge into ${session.baseBranch ?? 'the previous destination'} before choosing another destination.`,
            );
          if (preview.blockedReason) throw new Error(preview.blockedReason);
          await client
            .update(sessions)
            .set({ baseBranch: target })
            .where(eq(sessions.id, sessionId));
        }
        await repository.applyWorkspace(binding, {
          target,
          message: options?.commitMessage ?? options?.taskSlug ?? session.taskSlug,
        });
      }
    } catch (error) {
      await client
        .update(sessions)
        .set({ status: 'error', updatedAt: new Date() })
        .where(eq(sessions.id, sessionId));
      throw error;
    }
    await client
      .update(sessions)
      .set({
        status: resolution === 'merged' ? 'merged' : 'discarded',
        discardBackup,
        closedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(sessions.id, sessionId));
    this.onEvent?.('workspace:finalized', { sessionId, resolution });
  }
  async undoDiscard(sessionId: string): Promise<void> {
    const session = await this.db.query.sessions.findFirst({
      where: eq(sessions.id, sessionId),
      with: { project: true },
    });
    if (!session || session.status !== 'discarded' || !session.discardBackup)
      throw new Error('No recoverable discard exists for this session');
    const repository = await this.repositories.open(session.project.path);
    await repository.undoWorkspaceDiscard(this.binding(session), session.discardBackup);
    await this.db
      .update(sessions)
      .set({ status: 'idle', closedAt: null, discardBackup: null })
      .where(eq(sessions.id, sessionId));
    await repository.forgetRecovery(sessionId).catch(() => undefined);
    this.onEvent?.('workspace:restored', { sessionId });
  }
  private async openForCleanup(directory: string): Promise<SourceRepository | null> {
    try {
      return await this.repositories.open(directory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }
  async teardown(sessionId: string, options?: { dbTx?: unknown }): Promise<void> {
    const client = (options?.dbTx ?? this.db) as DbClient;
    const session = await client.query.sessions.findFirst({
      where: eq(sessions.id, sessionId),
      with: { project: true },
    });
    if (!session) throw new Error(`Session not found: ${sessionId}`);
    await this.stopSessionFn(sessionId);
    const repository = await this.openForCleanup(session.project.path);
    await repository?.forgetRecovery(sessionId).catch(() => undefined);
    if (session.mode === 'worktree') {
      await (
        await this.repositories.open(session.worktreePath).catch(() => null)
      )
        ?.cleanup()
        .catch(() => undefined);
      await repository?.retireWorkspace(this.binding(session)).catch(() => undefined);
    }
    await client.delete(sessions).where(eq(sessions.id, sessionId));
    if (
      !(await client.query.sessions.findFirst({ where: eq(sessions.projectId, session.projectId) }))
    )
      await repository?.cleanup().catch(() => undefined);
    this.onEvent?.('workspace:teardown', { sessionId });
  }
  async getHandle(sessionId: string): Promise<WorkspaceHandle> {
    const session = await this.db.query.sessions.findFirst({ where: eq(sessions.id, sessionId) });
    if (!session) throw new Error(`Session not found: ${sessionId}`);
    if (session.status === 'archived')
      throw new Error('Session workspace is archived. Resuscitation required.');
    const repository = await this.repositories.open(session.worktreePath);
    const baseline =
      session.baseCommit === 'none'
        ? undefined
        : await repository.importRevision(session.baseCommit);
    return {
      path: session.worktreePath,
      branch: session.branch,
      baseCommit: session.baseCommit,
      getReviewFiles: async () => (await repository.review(baseline)).files,
      getDiff: async () =>
        (await repository.review(baseline, { scope: 'session' })).files
          .map((file) => file.diff)
          .filter(Boolean)
          .join('\n'),
      stageFile: (file) => repository.stageFile(file),
      revertFile: async (file) => {
        if (!baseline) throw new Error('No checkpoint is available');
        await repository.revertFiles(baseline, [file]);
      },
    };
  }
  async syncOrphans(activeSessionIds: string[], knownSessionIds: string[]): Promise<void> {
    const allProjects = await this.db.query.projects.findMany();
    const finished = await this.db.query.sessions.findMany();
    const preservedIds = [
      ...activeSessionIds,
      ...finished
        .filter((session) => session.status === 'merged' || session.discardBackup)
        .map((session) => session.id),
    ];
    const visited = new Set<string>();
    for (const project of allProjects) {
      const repository = await this.openForCleanup(project.path);
      if (!repository) continue;
      if (visited.has(repository.info.repositoryId)) continue;
      visited.add(repository.info.repositoryId);
      await repository.syncWorkspaces(preservedIds, knownSessionIds);
    }
  }
}
