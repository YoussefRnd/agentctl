import { eq } from 'drizzle-orm';
import { sessions, projects, type DbClient } from '@agentctl/core/db';
import type { WorktreeManager } from '@agentctl/core/git';
import type { SessionManager } from '@agentctl/core/session';
import type { ProviderRegistry } from '@agentctl/core/providers';
import { canMutateWorkspace, sessionRowSchema } from '@agentctl/shared';
import { AppError } from '../errors/app-error.js';
import { refreshProjectRepository } from './project-repository.js';

/** Session-aware Git commands retain the existing command lane and workspace checks. */
export class SessionGitService {
  constructor(
    private readonly db: DbClient,
    private readonly sessionManager: Pick<
      SessionManager,
      'runWorkspaceCommand' | 'getSession' | 'stopSession' | 'getSnapshotService' | 'restartSession'
    >,
    private readonly worktreeManager: WorktreeManager,
    private readonly providerRegistry: Pick<ProviderRegistry, 'ensureProviderReady'>,
  ) {}

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
      return sessionRowSchema.parse(
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
    return sessionRowSchema.parse(updatedSession);
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
}
