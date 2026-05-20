import type { GitMutex } from '../utils/git-mutex.js';
import { GitService } from './git-service.js';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';

export interface WorktreeResult {
  path: string;
  workspacePath: string;
  branch: string;
  baseCommit: string;
}

export interface ReviewFile {
  path: string;
  state: 'untracked' | 'staged' | 'modified' | 'deleted' | 'committed';
  diff: string;
}

export class WorktreeManager {
  private baseDir = path.join(os.homedir(), '.agentctl', 'worktrees');

  constructor(
    private readonly gitMutex: GitMutex,
    private readonly gitService = new GitService(),
    baseDir?: string,
  ) {
    if (baseDir) {
      this.setBaseDir(baseDir);
    }
  }

  /**
   * Sets the base directory for worktrees.
   * Useful for testing isolation.
   */
  public setBaseDir(dir: string): void {
    this.baseDir = dir;
  }

  /**
   * Sanitizes strings for use in file paths.
   */
  private sanitize(input: string): string {
    return input.replace(/[^a-zA-Z0-9-]/g, '-').replace(/-+/g, '-');
  }

  /**
   * Spawns a new worktree for a session.
   * @param repoPath Absolute path to the main repository
   * @param sessionId Unique session ID
   * @param taskSlug URL-friendly task name
   * @param baseBranch Branch to branch off from (default: main)
   */
  async create(
    repoPath: string,
    sessionId: string,
    taskSlug: string,
    baseBranch = 'main',
    workdirPrefix = '',
  ): Promise<WorktreeResult> {
    const projectName = this.sanitize(path.basename(repoPath));
    const cleanSessionId = this.sanitize(sessionId);
    const cleanTaskSlug = this.sanitize(taskSlug);

    const storagePath = path.join(this.baseDir, projectName, cleanSessionId);
    const branchName = `agentctl/${cleanSessionId}/${cleanTaskSlug}`;

    // Ensure storage path's parent exists
    await fs.mkdir(path.dirname(storagePath), { recursive: true });

    return await this.gitMutex.run(repoPath, async () => {
      const base = await this.gitService.resolveBaseRef(repoPath, baseBranch);

      try {
        await this.gitService.addWorktree(repoPath, branchName, storagePath, base.ref);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes('already exists')) {
          // Future: could handle existing branches
        }
        throw error;
      }

      return {
        path: storagePath,
        workspacePath: this.gitService.joinWorkdir(storagePath, workdirPrefix),
        branch: branchName,
        baseCommit: base.commit,
      };
    });
  }

  /**
   * Lists worktrees that are NOT in the activeSessionIds list.
   * Only considers worktrees with branches starting with 'agentctl/'.
   */
  async listOrphans(
    repoPath: string,
    activeSessionIds: string[],
  ): Promise<{ path: string; branch: string }[]> {
    const cleanActiveIds = new Set(activeSessionIds.map((id) => this.sanitize(id)));

    return await this.gitMutex.run(repoPath, async () => {
      const worktrees = await this.gitService.listWorktrees(repoPath);

      return worktrees.filter(({ branch }) => {
        if (!branch.startsWith('agentctl/')) return false;
        const parts = branch.split('/');
        if (parts.length < 2) return false;
        return !cleanActiveIds.has(parts[1]);
      });
    });
  }

  /**
   * Removes a worktree and its associated branch.
   */
  async cleanup(repoPath: string, worktreePath: string, branchName: string): Promise<void> {
    await this.gitMutex.run(repoPath, async () => {
      await this.removeWorktree(repoPath, worktreePath, branchName);
    });
  }

  /**
   * Removes a worktree and its associated branch without mutex.
   * @internal
   */
  public async removeWorktree(
    repoPath: string,
    worktreePath: string,
    branchName: string,
  ): Promise<void> {
    // 1. Remove worktree
    try {
      await this.gitService.removeWorktree(repoPath, worktreePath);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      if (
        !message.includes('not a working tree') &&
        !message.includes('does not exist') &&
        !message.includes('is not a worktree')
      ) {
        throw error;
      }
    }

    // 2. Remove branch
    try {
      await this.gitService.deleteBranch(repoPath, branchName);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes('not found')) {
        throw error;
      }
    }
  }

  /**
   * Reconciles the state by removing worktrees that are no longer active.
   */
  async sync(repoPath: string, activeSessionIds: string[]): Promise<void> {
    const orphans = await this.listOrphans(repoPath, activeSessionIds);
    for (const orphan of orphans) {
      await this.cleanup(repoPath, orphan.path, orphan.branch);
    }
  }

  /**
   * Returns the unified diff between baseCommit and HEAD in the worktree.
   */
  async getDiff(repoPath: string, worktreePath: string, baseCommit: string): Promise<string> {
    return await this.gitMutex.run(repoPath, async () => {
      const currentBranch = await this.gitService.currentBranch(worktreePath);
      return await this.gitService.diff(repoPath, [`${baseCommit}...${currentBranch}`]);
    });
  }

  async getReviewFiles(
    repoPath: string,
    worktreePath: string,
    baseCommit: string,
  ): Promise<ReviewFile[]> {
    return await this.gitMutex.run(repoPath, async () => {
      const status = await this.gitService.status(worktreePath);
      const files = new Map<string, ReviewFile>();

      for (const file of status.files) {
        if (file.index === '?') {
          files.set(file.path, {
            path: file.path,
            state: 'untracked',
            diff: await this.gitService
              .raw(worktreePath, ['diff', '--no-index', '--', '/dev/null', file.path])
              .catch(() => `diff --git a/${file.path} b/${file.path}`),
          });
          continue;
        }

        if (file.index !== ' ' && file.index !== '?') {
          files.set(file.path, {
            path: file.path,
            state: 'staged',
            diff: await this.gitService.diff(worktreePath, ['--cached', '--', file.path]),
          });
          continue;
        }

        if (file.working_dir === 'D') {
          files.set(file.path, {
            path: file.path,
            state: 'deleted',
            diff: await this.gitService.diff(worktreePath, ['--', file.path]),
          });
          continue;
        }

        if (file.working_dir === 'M') {
          files.set(file.path, {
            path: file.path,
            state: 'modified',
            diff: await this.gitService.diff(worktreePath, ['--', file.path]),
          });
        }
      }

      const committedFiles = await this.gitService.raw(worktreePath, [
        'diff',
        '--name-only',
        `${baseCommit}...HEAD`,
      ]);
      for (const filePath of committedFiles.split('\n').filter(Boolean)) {
        if (files.has(filePath)) continue;

        files.set(filePath, {
          path: filePath,
          state: 'committed',
          diff: await this.gitService.diff(worktreePath, [`${baseCommit}...HEAD`, '--', filePath]),
        });
      }

      return [...files.values()];
    });
  }

  /**
   * Finalizes a worktree session by either merging or discarding changes.
   */
  async finalize(
    repoPath: string,
    worktreePath: string,
    branchName: string,
    baseBranch: string,
    action: 'merge' | 'discard',
    taskSlug: string,
    commitMessage?: string,
  ): Promise<void> {
    await this.gitMutex.run(repoPath, async () => {
      if (action === 'merge') {
        // Ensure the main repository is clean before proceeding
        if (!(await this.gitService.isClean(repoPath))) {
          throw new Error('Working tree is not clean. Cannot merge.');
        }

        await this.gitService.checkout(repoPath, baseBranch);

        try {
          await this.gitService.merge(repoPath, ['--squash', branchName]);
          try {
            await this.gitService.commit(repoPath, commitMessage ?? taskSlug);
          } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);
            if (
              !message.includes('nothing to commit') &&
              !message.includes('no changes added to commit')
            ) {
              throw error;
            }
          }
        } catch {
          // If merge fails (e.g. conflict), we DON'T cleanup.
          throw new Error('Merge conflict occurred');
        }
      }

      await this.removeWorktree(repoPath, worktreePath, branchName);
    });
  }
}
