import { simpleGit, type StatusResult } from 'simple-git';
import fs from 'node:fs/promises';
import path from 'node:path';

export interface RepositoryInfo {
  selectedPath: string;
  isGitRepo: boolean;
  repoRoot: string | null;
  workdirPrefix: string;
}

export interface BaseRefInfo {
  ref: string;
  commit: string;
  isEmpty: boolean;
}

export interface ListedWorktree {
  path: string;
  branch: string;
}

export class GitService {
  async resolveRepository(selectedPath: string): Promise<RepositoryInfo> {
    const stats = await fs.stat(selectedPath);
    if (!stats.isDirectory()) {
      throw new Error('Selected path is not a directory');
    }

    const git = simpleGit(selectedPath);
    const isGitRepo = await git.checkIsRepo().catch(() => false);

    if (!isGitRepo) {
      return {
        selectedPath,
        isGitRepo: false,
        repoRoot: null,
        workdirPrefix: '',
      };
    }

    const repoRoot = (await git.revparse(['--show-toplevel'])).trim();
    const rawPrefix = (await git.revparse(['--show-prefix'])).trim();
    const workdirPrefix = rawPrefix.replace(/\/$/, '');

    return {
      selectedPath,
      isGitRepo: true,
      repoRoot,
      workdirPrefix,
    };
  }

  async resolveBaseRef(repoPath: string, preferredRef = 'main'): Promise<BaseRefInfo> {
    const git = simpleGit(repoPath);
    let ref = preferredRef;
    let commit: string;

    try {
      commit = await git.revparse([ref]);
      return {
        ref,
        commit: commit.trim(),
        isEmpty: false,
      };
    } catch {
      const branchSummary = await git.branchLocal();
      ref = branchSummary.current || 'HEAD';
      try {
        commit = await git.revparse([ref]);
        return {
          ref,
          commit: commit.trim(),
          isEmpty: false,
        };
      } catch {
        return {
          ref,
          commit: 'empty',
          isEmpty: true,
        };
      }
    }
  }

  async addWorktree(repoPath: string, branchName: string, storagePath: string, baseRef: string) {
    const git = simpleGit(repoPath);

    // Remove if already registered
    const worktrees = await this.listWorktrees(repoPath);
    const worktreeExists = worktrees.some((w) => w.path === storagePath);
    if (worktreeExists) {
      await this.removeWorktree(repoPath, storagePath);
    }

    // Clear directory from disk
    await fs.rm(storagePath, { recursive: true, force: true }).catch(() => undefined);

    const branches = await git.branchLocal();
    const branchExists = branches.all.includes(branchName);

    if (branchExists) {
      await git.raw(['worktree', 'add', storagePath, branchName]);
    } else {
      await git.raw(['worktree', 'add', '-b', branchName, storagePath, baseRef]);
    }
  }

  async listWorktrees(repoPath: string): Promise<ListedWorktree[]> {
    const output = await simpleGit(repoPath).raw(['worktree', 'list', '--porcelain']);
    const lines = output.split('\n');
    const worktrees: ListedWorktree[] = [];

    let currentPath = '';
    for (const line of lines) {
      if (line.startsWith('worktree ')) {
        currentPath = line.substring(9).trim();
      } else if (line.startsWith('branch ')) {
        const fullBranch = line.substring(7).trim();
        const branch = fullBranch.startsWith('refs/heads/') ? fullBranch.substring(11) : fullBranch;
        worktrees.push({ path: currentPath, branch });
      }
    }

    return worktrees;
  }

  async removeWorktree(repoPath: string, worktreePath: string) {
    await simpleGit(repoPath).raw(['worktree', 'remove', '--force', worktreePath]);
  }

  async deleteBranch(repoPath: string, branchName: string) {
    await simpleGit(repoPath).raw(['branch', '-D', branchName]);
  }

  async currentBranch(worktreePath: string) {
    const branchSummary = await simpleGit(worktreePath).branch();
    return branchSummary.current;
  }

  async listBranches(repoPath: string): Promise<string[]> {
    const branchSummary = await simpleGit(repoPath).branchLocal();
    return branchSummary.all;
  }

  async diff(repoPath: string, args: string[]) {
    return simpleGit(repoPath).diff(args);
  }

  async raw(repoPath: string, args: string[]) {
    return simpleGit(repoPath).raw(args);
  }

  async status(repoPath: string): Promise<StatusResult> {
    return simpleGit(repoPath).status();
  }

  async isClean(repoPath: string) {
    const status = await this.status(repoPath);
    return status.isClean();
  }

  async checkout(repoPath: string, ref: string) {
    await simpleGit(repoPath).checkout(ref);
  }

  async merge(repoPath: string, args: string[]) {
    await simpleGit(repoPath).merge(args);
  }

  async commit(repoPath: string, message: string) {
    await simpleGit(repoPath).commit(message);
  }

  joinWorkdir(root: string, workdirPrefix: string) {
    return workdirPrefix ? path.join(root, workdirPrefix) : root;
  }
}
