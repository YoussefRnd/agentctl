import { eq, asc, inArray } from 'drizzle-orm';
import type { DbClient } from '../db/index.js';
import type { WorkspaceManager, Workspace as WorkspaceHandle } from './worktree-manager.js';
import { sessions, projects, acpEvents } from '../db/schema.js';
import type { SnapshotService } from './snapshot-service.js';
import type { SessionMode, ThinkingEffort } from '@agentctl/shared';
import crypto from 'node:crypto';
import { simpleGit } from 'simple-git';
import { DEFAULT_THINKING_EFFORT } from '../config/runtime-defaults.js';

export type WorkspaceTargetState = 'active' | 'archived' | 'finalized';
export type FinalizeResolution = 'merged' | 'discarded';

export interface EstablishOptions {
  selectedProvider: string;
  selectedModel: string;
  mode?: SessionMode;
  agent?: string;
  selectedThinkingEffort?: string;
  contextLimit?: number;
  sessionConfigOptions?: string;
  title?: string;
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

export class LocalWorkspaceAdapter implements WorkspaceHandle {
  constructor(
    public readonly path: string,
    public readonly branch: string,
    public readonly baseCommit: string,
    private readonly snapshotService: SnapshotService,
  ) {}

  async getDiff(): Promise<string> {
    if (this.baseCommit === 'none') return '';
    const git = simpleGit(this.path);
    return await git.diff([this.baseCommit]);
  }

  async getReviewFiles() {
    return this.snapshotService.getReviewFiles(this.path, this.baseCommit);
  }

  async stageFile(filePath: string): Promise<void> {
    const git = simpleGit(this.path);
    await git.add(filePath);
  }

  async revertFile(filePath: string): Promise<void> {
    const patches = await this.snapshotService.diff(this.path, this.baseCommit);
    const filePatch = patches.find((p) => p.path === filePath);
    if (filePatch) {
      await this.snapshotService.revertFiles(this.path, this.baseCommit, [filePatch]);
    }
  }
}

export class WorktreeWorkspaceAdapter implements WorkspaceHandle {
  constructor(
    private readonly workspace: WorkspaceHandle,
    private readonly snapshotService: SnapshotService,
  ) {}

  get path() {
    return this.workspace.path;
  }
  get branch() {
    return this.workspace.branch;
  }
  get baseCommit() {
    return this.workspace.baseCommit;
  }

  getDiff() {
    return this.workspace.getDiff();
  }
  getReviewFiles() {
    return this.snapshotService.getReviewFiles(this.path, this.baseCommit);
  }
  stageFile(filePath: string) {
    return this.workspace.stageFile(filePath);
  }
  async revertFile(filePath: string) {
    const patches = await this.snapshotService.diff(this.path, this.baseCommit);
    const filePatch = patches.find((patch) => patch.path === filePath);
    if (filePatch) {
      await this.snapshotService.revertFiles(this.path, this.baseCommit, [filePatch]);
    }
  }
}

export class SessionWorkspace {
  constructor(
    private readonly db: DbClient,
    private readonly workspaceManager: WorkspaceManager,
    private readonly stopSessionFn: (sessionId: string) => Promise<void> | void,
    private readonly getSnapshotServiceFn?: () => SnapshotService,
    private readonly onEvent?: (event: string, payload: Record<string, unknown>) => void,
  ) {}

  private getSnapshotService(): SnapshotService {
    if (!this.getSnapshotServiceFn) {
      throw new Error('SnapshotService not injected');
    }
    return this.getSnapshotServiceFn();
  }

  /**
   * Establishes a brand-new session workspace. Resolves mode fallbacks
   * (e.g. empty repos fallback to local mode), resolves base commits,
   * creates physical directories/worktrees, and inserts the database record.
   */
  async establish(
    projectId: string,
    taskSlug: string,
    options: EstablishOptions,
  ): Promise<WorkspaceContext> {
    const client = (options.dbTx ?? this.db) as DbClient;

    const project = await client.query.projects.findFirst({
      where: eq(projects.id, projectId),
    });

    if (!project) {
      throw new Error(`Project not found: ${projectId}`);
    }

    const sessionId = crypto.randomUUID();
    let branch = 'main';
    let worktreePath = project.path;
    let baseCommit = 'none';
    let baseBranch: string | null = null;
    let resolvedMode: SessionMode = options.mode ?? (project.repoRoot ? 'worktree' : 'local');

    if (project.repoRoot && resolvedMode === 'worktree') {
      try {
        const activeSessions = await client.query.sessions.findMany({
          where: inArray(sessions.status, ['idle', 'running', 'needs_attention', 'error']),
        });
        const activeSessionIds = activeSessions.map((s) => s.id);

        const baseRefInfo = await this.workspaceManager.resolveBaseRef(project.repoRoot, 'main');
        const worktree = await this.workspaceManager.create(
          project.repoRoot,
          sessionId,
          taskSlug,
          baseRefInfo.ref,
          project.subdir,
          activeSessionIds,
        );
        branch = worktree.branch;
        worktreePath = worktree.workspacePath;
        baseCommit = worktree.baseCommit;
        baseBranch = baseRefInfo.ref;
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes('empty repository')) {
          resolvedMode = 'local';
          worktreePath = project.path;
          baseCommit = 'none';
        } else {
          throw error;
        }
      }
    }

    if (resolvedMode === 'local') {
      let activeBranch = 'main';
      if (project.repoRoot) {
        try {
          const baseRefInfo = await this.workspaceManager.resolveBaseRef(project.repoRoot, 'main');
          activeBranch = baseRefInfo.ref;
        } catch {
          // Fallback to main
        }
      }
      branch = activeBranch;
      worktreePath = project.path;
      const snapshotService = this.getSnapshotService();
      const treeHash = await snapshotService.track(project.path);
      baseCommit = treeHash ?? 'none';
    }

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
      mode: resolvedMode,
      selectedProvider: options.selectedProvider,
      selectedModel: options.selectedModel,
      selectedThinkingEffort: (options.selectedThinkingEffort ??
        DEFAULT_THINKING_EFFORT) as ThinkingEffort,
      contextLimit: options.contextLimit ?? 0,
      sessionConfigOptions: options.sessionConfigOptions ?? '[]',
      title: options.title ?? 'new session',
    });

    if (this.onEvent) {
      this.onEvent('workspace:established', { sessionId, mode: resolvedMode, path: worktreePath });
    }

    return {
      sessionId,
      projectId,
      worktreePath,
      branch,
      mode: resolvedMode,
      baseCommit,
      baseBranch,
    };
  }

  /**
   * Transitions an existing workspace to the active state. This is used for
   * resuscitation (restoring worktrees/snapshots from archived status)
   * or mode-switching (local <-> worktree).
   */
  async activate(sessionId: string, options?: TransitionOptions): Promise<WorkspaceContext> {
    const client = (options?.dbTx ?? this.db) as DbClient;

    const session = await client.query.sessions.findFirst({
      where: eq(sessions.id, sessionId),
      with: { project: true },
    });

    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    // 1. Process termination first
    await this.stopSessionFn(sessionId);

    const project = session.project;
    const mode = options?.mode ?? session.mode;

    let newWorktreePath = session.worktreePath;
    let newBranch = session.branch;
    let newBaseCommit = session.baseCommit;
    let newBaseBranch = session.baseBranch;

    if (mode === 'worktree') {
      if (!project.repoRoot) {
        throw new Error('Project repo root not set. Cannot establish worktree.');
      }
      const activeSessions = await client.query.sessions.findMany({
        where: inArray(sessions.status, ['idle', 'running', 'needs_attention', 'error']),
      });
      const activeSessionIds = activeSessions.map((s) => s.id);

      const baseRefInfo = await this.workspaceManager.resolveBaseRef(
        project.repoRoot,
        options?.baseBranch ?? 'main',
      );
      const worktree = await this.workspaceManager.create(
        project.repoRoot,
        sessionId,
        options?.taskSlug ?? session.taskSlug,
        baseRefInfo.ref,
        project.subdir,
        activeSessionIds,
      );
      newWorktreePath = worktree.workspacePath;
      newBranch = worktree.branch;
      newBaseCommit = worktree.baseCommit;
      newBaseBranch = baseRefInfo.ref;
    } else {
      // Mode 'local'
      if (session.mode === 'worktree' && project.repoRoot) {
        // Clean up old worktree if we switched from worktree to local
        await this.workspaceManager.removeWorktreeOnly(project.repoRoot, session.worktreePath);
      }
      newWorktreePath = project.path;
      if (project.repoRoot) {
        newBranch = await this.workspaceManager
          .getCurrentBranch(project.repoRoot)
          .catch(() => newBranch);
      }
      const snapshotService = this.getSnapshotService();
      const treeHash = await snapshotService.track(project.path);
      newBaseCommit = treeHash ?? 'none';
      newBaseBranch = null;
    }

    await client
      .update(sessions)
      .set({
        mode,
        status: 'idle', // Ready to start running
        worktreePath: newWorktreePath,
        branch: newBranch,
        baseCommit: newBaseCommit,
        baseBranch: newBaseBranch,
        updatedAt: new Date(),
      })
      .where(eq(sessions.id, sessionId));

    if (this.onEvent) {
      this.onEvent('workspace:activated', { sessionId, path: newWorktreePath });
    }

    return {
      sessionId,
      projectId: session.projectId,
      worktreePath: newWorktreePath,
      branch: newBranch,
      mode,
      baseCommit: newBaseCommit,
      baseBranch: newBaseBranch,
    };
  }

  /**
   * Tears down physical files (deleting worktrees) to reclaim storage,
   * stops any running agent runtime, and updates the session status in the
   * database to 'archived'. Event history is preserved.
   */
  async archive(sessionId: string, options?: { dbTx?: unknown }): Promise<void> {
    const client = (options?.dbTx ?? this.db) as DbClient;

    const session = await client.query.sessions.findFirst({
      where: eq(sessions.id, sessionId),
      with: { project: true },
    });

    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    // 1. Process termination first
    await this.stopSessionFn(sessionId);

    const project = session.project;

    if (session.mode === 'worktree' && project.repoRoot) {
      await this.workspaceManager.removeWorktreeOnly(project.repoRoot, session.worktreePath);
    }

    await client
      .update(sessions)
      .set({ status: 'archived', updatedAt: new Date() })
      .where(eq(sessions.id, sessionId));

    if (this.onEvent) {
      this.onEvent('workspace:archived', { sessionId });
    }
  }

  /**
   * Squashes and merges changes into the base branch (worktree) or commits
   * changes (local) on success; otherwise, reverts changes to the baseline.
   * Stops the agent process and updates the session's final status.
   */
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

    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    // 1. Process termination first
    await this.stopSessionFn(sessionId);

    const project = session.project;

    try {
      if (session.mode === 'worktree') {
        if (!project.repoRoot) {
          throw new Error('Project repo root not set. Cannot finalize worktree session.');
        }
        await this.workspaceManager.finalize(
          project.repoRoot,
          session.worktreePath,
          session.branch,
          options?.baseBranch ?? session.baseBranch ?? 'main',
          resolution === 'merged' ? 'merge' : 'discard',
          options?.taskSlug ?? session.taskSlug,
          options?.commitMessage,
        );
      } else {
        // Mode 'local'
        if (resolution === 'discarded') {
          await this.revertLocalSessionChanges(sessionId, options);
        } else {
          await this.commitLocalSessionChanges(
            sessionId,
            options?.commitMessage ?? session.taskSlug,
            options,
          );
        }
      }
    } catch (err: unknown) {
      await client
        .update(sessions)
        .set({
          status: 'error',
          updatedAt: new Date(),
        })
        .where(eq(sessions.id, sessionId));
      throw err;
    }

    await client
      .update(sessions)
      .set({
        status: resolution === 'merged' ? 'merged' : 'discarded',
        closedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(sessions.id, sessionId));

    if (this.onEvent) {
      this.onEvent('workspace:finalized', { sessionId, resolution });
    }
  }

  /**
   * Stops the agent, deletes physical workspaces (worktrees/snapshots),
   * cleans up environment artifacts (e.g., copied .env files), and
   * deletes the database record entirely.
   */
  async teardown(sessionId: string, options?: { dbTx?: unknown }): Promise<void> {
    const client = (options?.dbTx ?? this.db) as DbClient;

    const session = await client.query.sessions.findFirst({
      where: eq(sessions.id, sessionId),
      with: { project: true },
    });

    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    // 1. Process termination first
    await this.stopSessionFn(sessionId);

    const project = session.project;

    if (session.mode === 'worktree' && project.repoRoot) {
      try {
        await this.workspaceManager.cleanup(project.repoRoot, session.worktreePath, session.branch);
      } catch {
        // Ignore errors during cleanup
      }
    }

    await client.delete(sessions).where(eq(sessions.id, sessionId));

    const remainingSessions = await client.query.sessions.findFirst({
      where: eq(sessions.projectId, project.id),
    });
    if (!remainingSessions && project.path) {
      await this.getSnapshotService()
        .deleteProjectSnapshots(project.path)
        .catch(() => undefined);
    }

    if (this.onEvent) {
      this.onEvent('workspace:teardown', { sessionId });
    }
  }

  /**
   * Returns a unified Workspace handle that lets callers stage, revert, and diff
   * changes. The caller does not know whether the handle is backed by a Git
   * worktree or a local shadow-snapshot system.
   */
  async getHandle(sessionId: string): Promise<WorkspaceHandle> {
    const session = await this.db.query.sessions.findFirst({
      where: eq(sessions.id, sessionId),
      with: { project: true },
    });

    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    if (session.status === 'archived') {
      throw new Error(`Session workspace is archived. Resuscitation required.`);
    }

    const project = session.project;

    if (session.mode === 'worktree') {
      const workspace = this.workspaceManager.getWorkspace(
        project.repoRoot ?? project.path,
        sessionId,
        session.taskSlug,
        session.worktreePath,
        session.baseCommit,
        session.branch,
      );
      return new WorktreeWorkspaceAdapter(workspace, this.getSnapshotService());
    } else {
      return new LocalWorkspaceAdapter(
        project.path,
        session.branch,
        session.baseCommit,
        this.getSnapshotService(),
      );
    }
  }

  /**
   * Iterates through all registered projects and prunes any physical worktrees
   * on disk that do not have a matching active database session.
   */
  async syncOrphans(activeSessionIds: string[]): Promise<void> {
    const allProjects = await this.db.query.projects.findMany();
    for (const project of allProjects) {
      if (project.repoRoot) {
        const isRepo = await simpleGit(project.repoRoot)
          .checkIsRepo()
          .catch(() => false);
        if (isRepo) {
          await this.workspaceManager.sync(project.repoRoot, activeSessionIds);
        }
      }
    }
  }

  private async commitLocalSessionChanges(
    sessionId: string,
    message: string,
    options?: { dbTx?: unknown },
  ): Promise<void> {
    const client = (options?.dbTx ?? this.db) as DbClient;

    const sessionRecord = await client.query.sessions.findFirst({
      where: eq(sessions.id, sessionId),
      with: { project: true },
    });

    if (!sessionRecord) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    if (sessionRecord.project.repoRoot && sessionRecord.baseCommit !== 'none') {
      const snapshotService = this.getSnapshotService();
      const patches = await snapshotService.diff(
        sessionRecord.project.path,
        sessionRecord.baseCommit,
      );
      if (patches.length > 0) {
        const git = simpleGit(sessionRecord.project.path);

        const toAdd = patches.filter((p) => p.status !== 'deleted').map((p) => p.path);
        const toRm = patches.filter((p) => p.status === 'deleted').map((p) => p.path);

        await git.reset();

        if (toAdd.length > 0) {
          await git.add(toAdd);
        }
        if (toRm.length > 0) {
          await git.rm(toRm).catch(() => undefined);
        }

        const status = await git.status();
        const stagedFiles = status.files.filter((f) => f.index !== ' ' && f.index !== '?');
        if (stagedFiles.length > 0) {
          await git.commit(message);
        }
      }
    }
  }

  private async revertLocalSessionChanges(
    sessionId: string,
    options?: { dbTx?: unknown },
  ): Promise<void> {
    const client = (options?.dbTx ?? this.db) as DbClient;

    const sessionRecord = await client.query.sessions.findFirst({
      where: eq(sessions.id, sessionId),
      with: { project: true },
    });

    if (!sessionRecord) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    let initialHash = sessionRecord.baseCommit;
    if (!initialHash || initialHash === 'none') {
      const allEvents = await client
        .select()
        .from(acpEvents)
        .where(eq(acpEvents.sessionId, sessionId))
        .orderBy(asc(acpEvents.id));

      for (const event of allEvents) {
        try {
          const metadata = (
            typeof event.metadata === 'string' ? JSON.parse(event.metadata) : event.metadata
          ) as Record<string, unknown> | null | undefined;
          if (metadata && typeof metadata.snapshotHash === 'string') {
            initialHash = metadata.snapshotHash;
            break;
          }
        } catch {
          // Ignore JSON parse errors
        }
      }
    }

    if (!initialHash || initialHash === 'none') {
      return;
    }

    const snapshotService = this.getSnapshotService();
    const projectPath = sessionRecord.project.path;

    const patches = await snapshotService.diff(projectPath, initialHash);
    await snapshotService.revertFiles(projectPath, initialHash, patches);
  }
}
