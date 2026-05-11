import { SimpleGit, simpleGit } from 'simple-git';
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
    const projectName = path.basename(repoPath);
    const storagePath = path.join(this.baseDir, projectName, sessionId);
    const branchName = `agentctl/${sessionId}/${taskSlug}`;

    // Ensure storage path's parent exists
    await fs.mkdir(path.dirname(storagePath), { recursive: true });

    return await this.gitMutex.run(repoPath, async () => {
      const git = simpleGit(repoPath);

      // 1. Check if the base branch exists (simple-git might throw if not, but good to be explicit or let git handle it)
      // 2. Add worktree: git worktree add -b agentctl/{id}/{slug} {path} {baseBranch}
      try {
        await git.raw(['worktree', 'add', '-b', branchName, storagePath, baseBranch]);
      } catch (error: any) {
        // Handle case where branch already exists or other git errors
        if (error.message.includes('already exists')) {
          // If the branch already exists, we might want to just add it without -b if it's already there?
          // But the requirement says "spawn a new worktree", and -b creates a new branch.
          // For now, let's rethrow or handle specifically.
          throw error;
        }
        throw error;
      }

      const headSha = await git.revparse(['HEAD']);

      return {
        path: storagePath,
        branch: branchName,
        baseCommit: headSha.trim(),
      };
    });
  }
}
