import { simpleGit } from 'simple-git';
import { GitMutex } from '../utils/git-mutex.js';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';

export interface WorktreeResult {
  path: string;
  branch: string;
  baseCommit: string;
}

export class WorktreeManager {
  private baseDir = path.join(os.homedir(), '.agentctl', 'worktrees');

  constructor(private gitMutex: GitMutex) {}

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
    baseBranch = 'main'
  ): Promise<WorktreeResult> {
    const projectName = this.sanitize(path.basename(repoPath));
    const cleanSessionId = this.sanitize(sessionId);
    const cleanTaskSlug = this.sanitize(taskSlug);

    const storagePath = path.join(this.baseDir, projectName, cleanSessionId);
    const branchName = `agentctl/${cleanSessionId}/${cleanTaskSlug}`;

    // Ensure storage path's parent exists
    await fs.mkdir(path.dirname(storagePath), { recursive: true });

    return await this.gitMutex.run(repoPath, async () => {
      const git = simpleGit(repoPath);

      // Get the SHA of the base branch before creating the worktree
      const baseCommit = await git.revparse([baseBranch]);

      try {
        await git.raw(['worktree', 'add', '-b', branchName, storagePath, baseBranch]);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes('already exists')) {
          // Future: could handle existing branches
        }
        throw error;
      }

      return {
        path: storagePath,
        branch: branchName,
        baseCommit: baseCommit.trim(),
      };
    });
  }

  /**
   * Lists worktrees that are NOT in the activeSessionIds list.
   * Only considers worktrees with branches starting with 'agentctl/'.
   */
  async listOrphans(
    repoPath: string,
    activeSessionIds: string[]
  ): Promise<{ path: string; branch: string }[]> {
    const cleanActiveIds = new Set(activeSessionIds.map((id) => this.sanitize(id)));

    return await this.gitMutex.run(repoPath, async () => {
      const git = simpleGit(repoPath);
      const output = await git.raw(['worktree', 'list', '--porcelain']);

      const lines = output.split('\n');
      const orphans: { path: string; branch: string }[] = [];

      let currentPath = '';
      for (const line of lines) {
        if (line.startsWith('worktree ')) {
          currentPath = line.substring(9).trim();
        } else if (line.startsWith('branch ')) {
          const fullBranch = line.substring(7).trim();
          const branchName = fullBranch.startsWith('refs/heads/')
            ? fullBranch.substring(11)
            : fullBranch;

          if (branchName.startsWith('agentctl/')) {
            const parts = branchName.split('/');
            if (parts.length >= 2) {
              const sessionId = parts[1];
              if (!cleanActiveIds.has(sessionId)) {
                orphans.push({ path: currentPath, branch: branchName });
              }
            }
          }
        }
      }

      return orphans;
    });
  }

  /**
   * Removes a worktree and its associated branch.
   */
  async cleanup(
    repoPath: string,
    worktreePath: string,
    branchName: string
  ): Promise<void> {
    await this.gitMutex.run(repoPath, async () => {
      await this.removeWorktree(repoPath, worktreePath, branchName);
    });
  }

  /**
   * Removes a worktree and its associated branch without mutex.
   */
  public async removeWorktree(
    repoPath: string,
    worktreePath: string,
    branchName: string
  ): Promise<void> {
    const git = simpleGit(repoPath);

    // 1. Remove worktree
    try {
      await git.raw(['worktree', 'remove', '--force', worktreePath]);
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
      await git.raw(['branch', '-D', branchName]);
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
  async getDiff(
    repoPath: string,
    worktreePath: string,
    baseCommit: string
  ): Promise<string> {
    return await this.gitMutex.run(repoPath, async () => {
      const git = simpleGit(repoPath);
      const worktreeGit = simpleGit(worktreePath);
      const branchSummary = await worktreeGit.branch();
      const currentBranch = branchSummary.current;

      return await git.diff([`${baseCommit}...${currentBranch}`]);
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
    commitMessage?: string
  ): Promise<void> {
    await this.gitMutex.run(repoPath, async () => {
      if (action === 'merge') {
        const git = simpleGit(repoPath);
        await git.checkout(baseBranch);

        try {
          await git.merge(['--squash', branchName]);
          try {
            await git.commit(commitMessage || taskSlug);
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
