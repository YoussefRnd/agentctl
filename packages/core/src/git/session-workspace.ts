import { canMutateWorkspace } from '@agentctl/shared';
import { eq, asc, inArray, and } from 'drizzle-orm';
import type { DbClient } from '../db/index.js';
import type { WorkspaceManager, Workspace as WorkspaceHandle } from './worktree-manager.js';
import { sessions, projects, sessionEvents } from '../db/schema.js';
import type { SnapshotService } from './snapshot-service.js';
import type { SessionMode, ThinkingEffort } from '@agentctl/shared';
import { NEW_SESSION_TITLE } from '@agentctl/shared';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { simpleGit } from 'simple-git';

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

export class WorkspaceUnavailableError extends Error {
  readonly statusCode = 409;
}

export class SessionWorkspace {
  private readonly availabilityChecks = new Map<string, Promise<boolean>>();

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
    let resolvedMode: SessionMode = project.repoRoot ? (options.mode ?? 'worktree') : 'local';

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
          activeBranch = await this.workspaceManager.getCurrentBranch(project.path);
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
      selectedThinkingEffort: options.selectedThinkingEffort ?? null,
      contextLimit: options.contextLimit ?? 0,
      sessionConfigOptions: options.sessionConfigOptions ?? '[]',
      title: options.title ?? NEW_SESSION_TITLE,
      approvalMode: options.approvalMode ?? 'review',
      agentPersona: options.agentPersona,
      availableAgentPersonas: JSON.stringify(options.availableAgentPersonas ?? []),
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

  /** Repair an absent active workspace without resetting its branch or baseline. */
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
    ) {
      return false;
    }

    const exists = await fs
      .stat(session.worktreePath)
      .then((s) => s.isDirectory())
      .catch((err: NodeJS.ErrnoException) => {
        if (err.code !== 'ENOENT') throw err;
        return false;
      });
    if (exists) return false;
    if (!session.project.repoRoot) {
      throw new Error(`Cannot restore workspace: project has no repository: ${sessionId}`);
    }

    // A running provider retains its old cwd even after the directory is restored.
    await this.stopSessionFn(sessionId);
    const messages = await this.db
      .select({ id: sessionEvents.id })
      .from(sessionEvents)
      .where(and(eq(sessionEvents.sessionId, sessionId), eq(sessionEvents.type, 'text')));
    const hasConversation = messages.length > 0;
    try {
      await this.workspaceManager.restore(
        session.project.repoRoot,
        session.branch,
        session.worktreePath,
        session.baseCommit,
        session.project.subdir,
        !hasConversation,
      );
    } catch (err) {
      throw new WorkspaceUnavailableError(err instanceof Error ? err.message : String(err));
    }
    this.onEvent?.('workspace:restored', { sessionId, path: session.worktreePath });
    return true;
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

    if (
      mode === 'worktree' &&
      session.status === 'archived' &&
      session.mode === 'worktree' &&
      (await fs.stat(session.worktreePath).catch(() => null))?.isDirectory()
    ) {
      // Retained archive: keep its branch, baseline, staging, and uncommitted files.
    } else if (mode === 'worktree') {
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
        if (!(await this.workspaceManager.isCleanWorkspace(project.repoRoot, session.worktreePath)))
          throw new Error('Commit or discard changes before switching workspace mode');
        // Clean up a clean old worktree after a mode switch.
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
   * Stops the agent runtime and archives the session while retaining its
   * worktree, staging, and event history for resumption. Deleting the session
   * is the explicit operation that removes its workspace.
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

    if (!canMutateWorkspace(session.status)) {
      throw new Error('Stop the active turn before finalizing an idle session');
    }
    // 1. Process termination first
    await this.stopSessionFn(sessionId);

    const project = session.project;

    try {
      if (session.mode === 'worktree') {
        if (resolution === 'discarded') {
          await client
            .update(sessions)
            .set({ discardBackup: JSON.stringify({ worktree: true }) })
            .where(eq(sessions.id, sessionId));
        }
        if (!project.repoRoot) {
          throw new Error('Project repo root not set. Cannot finalize worktree session.');
        }
        const targetBranch = options?.baseBranch ?? session.baseBranch ?? 'main';
        if (resolution === 'merged' && targetBranch !== (session.baseBranch ?? 'main')) {
          // Remember a validated destination before attempting the merge, so a
          // conflict can be retried against the same branch after reopening.
          const preview = await this.workspaceManager.getMergePreview(
            project.repoRoot,
            session.worktreePath,
            session.branch,
            targetBranch,
          );
          if (preview.hasMergeHead)
            throw new Error(
              `Finish or abort the pending merge into ${session.baseBranch ?? 'main'} before choosing another destination.`,
            );
          if (preview.blockedReason) throw new Error(preview.blockedReason);
          await client
            .update(sessions)
            .set({ baseBranch: targetBranch })
            .where(eq(sessions.id, sessionId));
        }
        await this.workspaceManager.finalize(
          project.repoRoot,
          session.worktreePath,
          session.branch,
          targetBranch,
          resolution === 'merged' ? 'merge' : 'discard',
          options?.taskSlug ?? session.taskSlug,
          options?.commitMessage,
        );
      } else {
        // Mode 'local'
        if (resolution === 'discarded') {
          await this.workspaceManager.withRepositoryLock(
            project.repoRoot ?? project.path,
            async () => {
              const snapshotHash = await this.getSnapshotService().track(project.path);
              if (snapshotHash) {
                const git = simpleGit(project.path);
                const indexTree = (await git.raw(['write-tree'])).trim();
                await git.raw([
                  'update-ref',
                  `refs/agentctl/discard-index/${sessionId}`,
                  indexTree,
                ]);
                const headCommit = (await git.revparse(['HEAD']).catch(() => '')).trim();
                await this.revertLocalSessionChanges(sessionId, options);
                const postSnapshotHash = await this.getSnapshotService().track(project.path);
                const postIndexTree = (await git.raw(['write-tree'])).trim();
                await client
                  .update(sessions)
                  .set({
                    discardBackup: JSON.stringify({
                      snapshotHash,
                      indexTree,
                      headCommit,
                      postSnapshotHash,
                      postIndexTree,
                    }),
                  })
                  .where(eq(sessions.id, sessionId));
              }
            },
          );
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
        ...(resolution === 'merged' ? { discardBackup: null } : {}),
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

    if (project.repoRoot)
      await simpleGit(project.repoRoot)
        .raw(['update-ref', '-d', `refs/agentctl/discard-index/${sessionId}`])
        .catch(() => undefined);
    if (session.mode === 'worktree' && project.repoRoot) {
      await this.getSnapshotService()
        .deleteProjectSnapshots(session.worktreePath)
        .catch(() => undefined);
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

  /** Keep finished workspaces recoverable until the user explicitly deletes them. */
  async syncOrphans(activeSessionIds: string[], knownSessionIds: string[]): Promise<void> {
    const allProjects = await this.db.query.projects.findMany();
    const finished = await this.db.query.sessions.findMany();
    const preservedIds = [
      ...activeSessionIds,
      ...finished
        .filter((session) => session.status === 'merged' || session.discardBackup)
        .map((session) => session.id),
    ];
    const repositories = new Set(
      allProjects
        .map((project) => project.repoRoot)
        .filter((root): root is string => root !== null),
    );
    for (const repoRoot of repositories) {
      const isRepo = await simpleGit(repoRoot)
        .checkIsRepo()
        .catch(() => false);
      if (isRepo) {
        await this.workspaceManager.sync(repoRoot, preservedIds, knownSessionIds);
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

    const repository = await this.workspaceManager.resolveRepository(sessionRecord.project.path);
    if (!repository.isGitRepo || !repository.repoRoot) return;
    if (
      sessionRecord.project.repoRoot !== repository.repoRoot ||
      sessionRecord.project.subdir !== repository.workdirPrefix
    ) {
      await client
        .update(projects)
        .set({ repoRoot: repository.repoRoot, subdir: repository.workdirPrefix })
        .where(eq(projects.id, sessionRecord.projectId));
    }
    await this.workspaceManager.withRepositoryLock(repository.repoRoot, async () => {
      const userGit = simpleGit(sessionRecord.project.path);
      if (sessionRecord.baseCommit === 'none') {
        // Without a baseline we cannot distinguish session edits from earlier work.
        // Require an explicit commit rather than silently closing a dirty session.
        if (!(await userGit.status()).isClean()) {
          throw new Error(
            'Git was initialized after this session started. Commit the workspace changes before applying the session.',
          );
        }
        await userGit.revparse(['--verify', 'HEAD']);
        return;
      }
      const patches = await this.getSnapshotService().diff(
        sessionRecord.project.path,
        sessionRecord.baseCommit,
      );
      if (!patches.length) return;
      if ((await userGit.status()).conflicted.length)
        throw new Error('Resolve conflicts before applying');
      const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'agentctl-apply-'));
      try {
        // A separate index commits selected files and preserves unrelated staging.
        const git = simpleGit({
          baseDir: sessionRecord.project.path,
          timeout: { block: 120000, stdErr: false, stdOut: false },
        }).env('GIT_INDEX_FILE', path.join(temporary, 'index'));
        const hasHead = await userGit
          .revparse(['--verify', 'HEAD'])
          .then(() => true)
          .catch(() => false);
        await git.raw(hasHead ? ['read-tree', 'HEAD'] : ['read-tree', '--empty']);
        const paths = patches.map((patch) => patch.path);
        await git.raw(['--literal-pathspecs', 'add', '-A', '--', ...paths]);
        if (!(await git.diff(['--cached', '--name-only'])).trim()) return;
        const before = (await userGit.revparse(['HEAD']).catch(() => '')).trim();
        await git.commit(message);
        const after = (await userGit.revparse(['HEAD']).catch(() => '')).trim();
        if (after === before)
          throw new Error('Git did not create the Apply commit. Check your commit hooks.');
        await this.workspaceManager.unstagePaths(sessionRecord.project.path, paths);
      } finally {
        await fs.rm(temporary, { recursive: true, force: true });
      }
    });
  }

  async undoDiscard(sessionId: string): Promise<void> {
    const session = await this.db.query.sessions.findFirst({
      where: eq(sessions.id, sessionId),
      with: { project: true },
    });
    if (!session || session.status !== 'discarded' || !session.discardBackup)
      throw new Error('No recoverable discard exists for this session');
    await this.workspaceManager.withRepositoryLock(
      session.project.repoRoot ?? session.project.path,
      async () => {
        if (session.mode === 'worktree') {
          if (!(await fs.stat(session.worktreePath).catch(() => null))?.isDirectory())
            throw new Error('The retained workspace is missing');
        } else {
          const backup = JSON.parse(session.discardBackup!) as {
            snapshotHash: string;
            indexTree: string;
            headCommit: string;
            postSnapshotHash: string;
            postIndexTree: string;
          };
          const git = simpleGit(session.worktreePath);
          const head = (await git.revparse(['HEAD']).catch(() => '')).trim();
          const index = (await git.raw(['write-tree'])).trim();
          const current = await this.getSnapshotService().track(session.worktreePath);
          if (
            head !== backup.headCommit ||
            index !== backup.postIndexTree ||
            current !== backup.postSnapshotHash
          ) {
            throw new Error(
              'Workspace changed after discard. Preserve those changes before recovering.',
            );
          }
          await this.getSnapshotService().restoreFiles(session.worktreePath, backup.snapshotHash);
          await git.raw(['read-tree', backup.indexTree]);
        }
        await this.db
          .update(sessions)
          .set({ status: 'idle', closedAt: null, discardBackup: null })
          .where(eq(sessions.id, sessionId));
      },
    );
    if (session.project.repoRoot) {
      await simpleGit(session.worktreePath)
        .raw(['update-ref', '-d', `refs/agentctl/discard-index/${sessionId}`])
        .catch(() => undefined);
    }
    this.onEvent?.('workspace:restored', { sessionId });
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
        .from(sessionEvents)
        .where(eq(sessionEvents.sessionId, sessionId))
        .orderBy(asc(sessionEvents.id));

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
    if (patches.length)
      await this.workspaceManager.unstagePaths(
        projectPath,
        patches.map((patch) => patch.path),
      );
  }
}
