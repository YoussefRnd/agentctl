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
      // This is our 'baseCommit' for triple-dot diffs.
      const baseCommit = await git.revparse([baseBranch]);

      try {
        await git.raw(['worktree', 'add', '-b', branchName, storagePath, baseBranch]);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes('already exists')) {
          // Future: could handle existing branches by checking them out instead of -b
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
          // branch is usually refs/heads/branch-name
          const branchName = fullBranch.startsWith('refs/heads/')
            ? fullBranch.substring(11)
            : fullBranch;

          if (branchName.startsWith('agentctl/')) {
            const parts = branchName.split('/');
            // agentctl/{sessionId}/{taskSlug}
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
      await this._cleanup(repoPath, worktreePath, branchName);
    });
  }

  /**
   * Internal cleanup logic without mutex.
   */
  private async _cleanup(
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
      // Ignore if already gone
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
      // Ignore if already gone
      if (!message.includes('not found')) {
        throw error;
      }
    }
  }

  /**
   * Reconciles the state by removing worktrees that are no longer active.
   * @param repoPath Absolute path to the main repository
   * @param activeSessionIds List of session IDs that should be kept
   */
  async sync(repoPath: string, activeSessionIds: string[]): Promise<void> {
    const orphans = await this.listOrphans(repoPath, activeSessionIds);
    for (const orphan of orphans) {
      await this.cleanup(repoPath, orphan.path, orphan.branch);
    }
  }

  /**
   * Returns the unified diff between baseCommit and HEAD in the worktree.
   * Note: This only shows COMMITTED changes on the branch.
   */
  async getDiff(
    repoPath: string,
    worktreePath: string,
    baseCommit: string
  ): Promise<string> {
    return await this.gitMutex.run(repoPath, async () => {
      const git = simpleGit(worktreePath);
      return await git.diff([`${baseCommit}...HEAD`]);
    });
  }

  /**
   * Finalizes a worktree session by either merging or discarding changes.
   * @param repoPath Absolute path to the main repository
   * @param worktreePath Path to the worktree to clean up
   * @param branchName Name of the branch to clean up
   * @param baseBranch Branch to merge into if merging (e.g. main)
   * @param action 'merge' or 'discard'
   * @param commitMessage Message for the squash merge commit
   */
  async finalize(
    repoPath: string,
    worktreePath: string,
    branchName: string,
    baseBranch: string,
    action: 'merge' | 'discard',
    commitMessage?: string
  ): Promise<void> {
    return await this.gitMutex.run(repoPath, async () => {
      if (action === 'merge') {
        const git = simpleGit(repoPath);
        // Ensure we are on the base branch
        await git.checkout(baseBranch);
        // Squash merge the worktree branch
        await git.merge(['--squash', branchName]);
        // Commit the squashed changes
        await git.commit(commitMessage || `Merge ${branchName}`);
      }

      // Always cleanup
      await this._cleanup(repoPath, worktreePath, branchName);
    });
  }
}
