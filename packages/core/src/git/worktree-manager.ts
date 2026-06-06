import type { GitMutex } from '../utils/git-mutex.js';
import { simpleGit } from 'simple-git';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';

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

export interface Workspace {
  readonly path: string;
  readonly branch: string;
  readonly baseCommit: string;

  getDiff(): Promise<string>;
  getReviewFiles(): Promise<ReviewFile[]>;
  stageFile(filePath: string): Promise<void>;
  revertFile(filePath: string): Promise<void>;
}

export class WorkspaceManager {
  private baseDir = path.join(os.homedir(), '.agentctl', 'worktrees');

  constructor(
    private readonly gitMutex: GitMutex,
    baseDir?: string,
  ) {
    if (baseDir) {
      this.setBaseDir(baseDir);
    }
  }

  public setBaseDir(dir: string): void {
    this.baseDir = dir;
  }

  private sanitize(input: string): string {
    return input.replace(/[^a-zA-Z0-9-]/g, '-').replace(/-+/g, '-');
  }

  // Raw Git helpers encapsulated inside WorkspaceManager

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

  async listBranches(repoPath: string): Promise<string[]> {
    const branchSummary = await simpleGit(repoPath).branchLocal();
    return branchSummary.all;
  }

  async checkout(repoPath: string, ref: string): Promise<void> {
    await simpleGit(repoPath).checkout(ref);
  }

  private async addWorktree(repoPath: string, branchName: string, storagePath: string, baseRef: string): Promise<void> {
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

  private async listWorktrees(repoPath: string): Promise<ListedWorktree[]> {
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

  private async removeWorktree(repoPath: string, worktreePath: string): Promise<void> {
    await simpleGit(repoPath).raw(['worktree', 'remove', '--force', worktreePath]);
  }

  private async deleteBranch(repoPath: string, branchName: string): Promise<void> {
    await simpleGit(repoPath).raw(['branch', '-D', branchName]);
  }

  // Public WorkspaceManager lifecycle API

  async create(
    repoPath: string,
    sessionId: string,
    taskSlug: string,
    baseBranch = 'main',
    workdirPrefix = '',
  ): Promise<WorktreeResult> {
    const projectName = this.sanitize(path.basename(repoPath));
    const cleanSessionId = this.sanitize(sessionId);
    const cleanTaskSlug = this.sanitize(taskSlug).slice(0, 30);

    const storagePath = path.join(this.baseDir, projectName, cleanSessionId);
    const branchName = `agentctl/${cleanSessionId}/${cleanTaskSlug}`;

    await fs.mkdir(path.dirname(storagePath), { recursive: true });

    return await this.gitMutex.run(repoPath, async () => {
      const base = await this.resolveBaseRef(repoPath, baseBranch);
      if (base.isEmpty) {
        throw new Error('Cannot create worktree in an empty repository (no commits found)');
      }

      await this.addWorktree(repoPath, branchName, storagePath, base.ref);

      return {
        path: storagePath,
        workspacePath: workdirPrefix ? path.join(storagePath, workdirPrefix) : storagePath,
        branch: branchName,
        baseCommit: base.commit,
      };
    });
  }

  async listOrphans(
    repoPath: string,
    activeSessionIds: string[],
  ): Promise<{ path: string; branch: string }[]> {
    const cleanActiveIds = new Set(activeSessionIds.map((id) => this.sanitize(id)));

    return await this.gitMutex.run(repoPath, async () => {
      const worktrees = await this.listWorktrees(repoPath);

      return worktrees.filter(({ branch }) => {
        if (!branch.startsWith('agentctl/')) return false;
        const parts = branch.split('/');
        if (parts.length < 2) return false;
        return !cleanActiveIds.has(parts[1]);
      });
    });
  }

  async cleanup(repoPath: string, worktreePath: string, branchName: string): Promise<void> {
    await this.gitMutex.run(repoPath, async () => {
      await this.removeWorktreeAndBranch(repoPath, worktreePath, branchName);
    });
  }

  private async removeWorktreeAndBranch(
    repoPath: string,
    worktreePath: string,
    branchName: string,
  ): Promise<void> {
    try {
      await this.removeWorktree(repoPath, worktreePath);
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

    try {
      await this.deleteBranch(repoPath, branchName);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes('not found')) {
        throw error;
      }
    }
  }

  async sync(repoPath: string, activeSessionIds: string[]): Promise<void> {
    const orphans = await this.listOrphans(repoPath, activeSessionIds);
    for (const orphan of orphans) {
      await this.cleanup(repoPath, orphan.path, orphan.branch);
    }
  }

  async getDiff(repoPath: string, worktreePath: string, baseCommit: string): Promise<string> {
    return await this.gitMutex.run(repoPath, async () => {
      const branchSummary = await simpleGit(worktreePath).branch();
      const currentBranch = branchSummary.current;
      return await simpleGit(repoPath).diff([`${baseCommit}...${currentBranch}`]);
    });
  }

  async getReviewFiles(
    repoPath: string,
    worktreePath: string,
    baseCommit: string,
  ): Promise<ReviewFile[]> {
    return await this.gitMutex.run(repoPath, async () => {
      const git = simpleGit(worktreePath);
      const status = await git.status();
      const files = new Map<string, ReviewFile>();

      for (const file of status.files) {
        if (file.index === '?') {
          files.set(file.path, {
            path: file.path,
            state: 'untracked',
            diff: await git
              .raw(['diff', '--no-index', '--', '/dev/null', file.path])
              .catch(() => `diff --git a/${file.path} b/${file.path}`),
          });
          continue;
        }

        if (file.index !== ' ' && file.index !== '?') {
          files.set(file.path, {
            path: file.path,
            state: 'staged',
            diff: await git.diff(['--cached', '--', file.path]),
          });
          continue;
        }

        if (file.working_dir === 'D') {
          files.set(file.path, {
            path: file.path,
            state: 'deleted',
            diff: await git.diff(['--', file.path]),
          });
          continue;
        }

        if (file.working_dir === 'M') {
          files.set(file.path, {
            path: file.path,
            state: 'modified',
            diff: await git.diff(['--', file.path]),
          });
        }
      }

      const committedFiles = await git.raw([
        'diff',
        '--name-only',
        `${baseCommit}...HEAD`,
      ]);
      for (const filePath of committedFiles.split('\n').filter(Boolean)) {
        if (files.has(filePath)) continue;

        files.set(filePath, {
          path: filePath,
          state: 'committed',
          diff: await git.diff([`${baseCommit}...HEAD`, '--', filePath]),
        });
      }

      return [...files.values()];
    });
  }

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
        const status = await simpleGit(repoPath).status();
        if (!status.isClean()) {
          throw new Error('Working tree is not clean. Cannot merge.');
        }

        await simpleGit(repoPath).checkout(baseBranch);

        try {
          await simpleGit(repoPath).merge(['--squash', branchName]);
          try {
            await simpleGit(repoPath).commit(commitMessage ?? taskSlug);
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
          throw new Error('Merge conflict occurred');
        }
      }

      await this.removeWorktreeAndBranch(repoPath, worktreePath, branchName);
    });
  }

  async stageFile(repoPath: string, worktreePath: string, filePath: string): Promise<void> {
    await this.gitMutex.run(repoPath, async () => {
      await simpleGit(worktreePath).raw(['add', filePath]);
    });
  }

  async revertFile(repoPath: string, worktreePath: string, filePath: string): Promise<void> {
    await this.gitMutex.run(repoPath, async () => {
      try {
        await simpleGit(worktreePath).raw(['reset', 'HEAD', filePath]);
      } catch {
        // Not staged
      }
      await simpleGit(worktreePath).raw(['checkout', '--', filePath]);
    });
  }

  // Factory/adapter method to retrieve a Workspace instance
  getWorkspace(
    repoPath: string,
    sessionId: string,
    taskSlug: string,
    worktreePath: string,
    baseCommit: string,
    branch: string,
  ): Workspace {
    return {
      path: worktreePath,
      branch,
      baseCommit,
      getDiff: async () => {
        return this.getDiff(repoPath, worktreePath, baseCommit);
      },
      getReviewFiles: async () => {
        return this.getReviewFiles(repoPath, worktreePath, baseCommit);
      },
      stageFile: async (filePath: string) => {
        return this.stageFile(repoPath, worktreePath, filePath);
      },
      revertFile: async (filePath: string) => {
        return this.revertFile(repoPath, worktreePath, filePath);
      },
    };
  }
}

// Keep export alias for backward compatibility
export { WorkspaceManager as WorktreeManager };
