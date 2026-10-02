import { resolveRepositoryContext, type RepositoryContext } from './repository-context.js';
import type { GitMutex } from './mutex.js';
import { simpleGit } from 'simple-git';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { ReviewFile } from './utils.js';
import { SnapshotService } from './snapshot-service.js';
import { resolveWorkspaceFile } from './file-safety.js';

const execFileAsync = promisify(execFile);

export type RepositoryInfo = Pick<
  RepositoryContext,
  'selectedPath' | 'isGitRepo' | 'repoRoot' | 'workdirPrefix'
>;

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

export interface Workspace {
  readonly path: string;
  readonly branch: string;
  readonly baseCommit: string;

  getDiff(): Promise<string>;
  getReviewFiles(): Promise<ReviewFile[]>;
  stageFile(filePath: string): Promise<void>;
  revertFile(filePath: string): Promise<void>;
}

export function parseGitHubRemoteUrl(remoteUrl: string): string | null {
  const match = /github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?$/.exec(remoteUrl.trim());
  return match ? `https://github.com/${match[1]}/${match[2]}` : null;
}

export function parsePorcelainWorktrees(output: string): ListedWorktree[] {
  const fields = output.split('\0');
  const worktrees: ListedWorktree[] = [];
  let currentPath: string | null = null;
  let currentBranch: string | null = null;
  let isPrunable = false;

  const flush = () => {
    if (currentPath !== null && !isPrunable) {
      worktrees.push({
        path: currentPath,
        branch: currentBranch ?? 'HEAD',
      });
    }
    currentPath = null;
    currentBranch = null;
    isPrunable = false;
  };

  for (const field of fields) {
    if (field === '') {
      flush();
    } else if (field.startsWith('worktree ')) {
      currentPath = field.slice('worktree '.length).trim();
    } else if (field.startsWith('branch refs/heads/')) {
      currentBranch = field.slice('branch refs/heads/'.length).trim();
    } else if (field.startsWith('branch ')) {
      const fullBranch = field.slice('branch '.length).trim();
      currentBranch = fullBranch.startsWith('refs/heads/') ? fullBranch.slice(11) : fullBranch;
    } else if (field === 'detached') {
      currentBranch = 'HEAD';
    } else if (field === 'prunable' || field.startsWith('prunable ')) {
      isPrunable = true;
    }
  }
  flush();

  return worktrees;
}

export class WorkspaceManager {
  private baseDir = path.join(os.homedir(), '.agentctl', 'worktrees');
  private reviewService?: SnapshotService;
  private readonly prCache = new Map<
    string,
    { expiresAt: number; value: ReturnType<WorkspaceManager['detectPullRequest']> }
  >();
  private readonly fetchedAt = new Map<string, string>();

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
    this.reviewService = undefined;
  }

  private sanitize(input: string): string {
    return input.replace(/[^a-zA-Z0-9-]/g, '-').replace(/-+/g, '-');
  }

  // Raw Git helpers encapsulated inside WorkspaceManager

  async resolveRepository(selectedPath: string): Promise<RepositoryInfo> {
    const {
      selectedPath: canonicalPath,
      isGitRepo,
      repoRoot,
      workdirPrefix,
    } = await resolveRepositoryContext(selectedPath);
    return { selectedPath: canonicalPath, isGitRepo, repoRoot, workdirPrefix };
  }

  async resolveBaseRef(repoPath: string, preferredRef = 'main'): Promise<BaseRefInfo> {
    const git = simpleGit(repoPath);
    const currentBranch = await this.getCurrentBranch(repoPath);

    // If preferredRef is not found in the local repository, fallback to current active branch
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
      ref = currentBranch;
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

  async getCurrentBranch(repoPath: string): Promise<string> {
    const git = simpleGit(repoPath);
    try {
      // An unborn branch has a symbolic HEAD but is absent from `git branch`.
      const branch = (await git.raw(['symbolic-ref', '--quiet', '--short', 'HEAD'])).trim();
      if (branch) return branch;
    } catch {
      // `symbolic-ref --quiet` exits unsuccessfully for a detached checkout.
    }
    // Only a valid detached checkout should use the HEAD label.
    await git.revparse(['--verify', 'HEAD']);
    return 'HEAD';
  }

  async listBranches(repoPath: string): Promise<string[]> {
    const branchSummary = await simpleGit(repoPath).branchLocal();
    return branchSummary.all;
  }

  async checkout(repoPath: string, ref: string): Promise<void> {
    await this.gitMutex.run(repoPath, async () => {
      await simpleGit(repoPath).checkout(ref);
    });
  }

  private async addWorktree(
    repoPath: string,
    branchName: string,
    storagePath: string,
    baseRef: string,
  ): Promise<void> {
    const git = simpleGit(repoPath);

    const branchExists = (await git.branchLocal()).all.includes(branchName);
    // Let Git reject an occupied directory; never reset or delete a workspace
    // simply because it is absent from this process's database.
    await git.raw(
      branchExists
        ? ['worktree', 'add', storagePath, branchName]
        : ['worktree', 'add', '-b', branchName, storagePath, baseRef],
    );
  }

  async getActiveBranchesInWorktrees(repoPath: string): Promise<string[]> {
    const list = await this.listWorktrees(repoPath);
    return list.map((w) => w.branch);
  }

  private async listWorktrees(repoPath: string): Promise<ListedWorktree[]> {
    const git = simpleGit(repoPath);
    const isRepo = await git.checkIsRepo().catch(() => false);
    if (!isRepo) {
      return [];
    }
    const output = await git.raw(['worktree', 'list', '--porcelain', '-z']).catch(() => '');
    if (!output) {
      return [];
    }
    const parsed = parsePorcelainWorktrees(output);

    // Verify paths exist on disk to filter out pruned/missing worktrees
    const validWorktrees: ListedWorktree[] = [];
    for (const wt of parsed) {
      const exists = await fs
        .stat(wt.path)
        .then((s) => s.isDirectory())
        .catch(() => false);
      if (exists) {
        validWorktrees.push(wt);
      }
    }

    return validWorktrees;
  }

  private async removeWorktree(repoPath: string, worktreePath: string): Promise<void> {
    let rootPath = worktreePath;
    try {
      const git = simpleGit(worktreePath);
      const resolved = await git.revparse(['--show-toplevel']);
      if (resolved.trim()) {
        rootPath = resolved.trim();
      }
    } catch {
      // ignore, fallback to worktreePath
    }
    await simpleGit(repoPath).raw(['worktree', 'remove', '--force', rootPath]);
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
    _activeSessionIds: string[] = [],
  ): Promise<WorktreeResult> {
    const projectName = this.sanitize(path.basename(repoPath));
    const cleanSessionId = this.sanitize(sessionId);
    const cleanTaskSlug = this.sanitize(taskSlug).slice(0, 40);
    const branchName = `agentctl/${cleanSessionId}/${cleanTaskSlug}`;

    // Reserve a fresh directory while holding the repository lock. A worktree
    // absent from this process's session list may belong to another database.
    return await this.gitMutex.run(repoPath, async () => {
      const baseFolderName = cleanTaskSlug || 'workspace';
      let storagePath = '';
      for (let i = 0; i < 1000; i++) {
        const folderName = i === 0 ? baseFolderName : `${baseFolderName}-${i + 1}`;
        const candidatePath = path.join(this.baseDir, projectName, folderName);
        const exists = await fs
          .lstat(candidatePath)
          .then(() => true)
          .catch((err: NodeJS.ErrnoException) => {
            if (err.code !== 'ENOENT') throw err;
            return false;
          });
        if (!exists) {
          storagePath = candidatePath;
          break;
        }
      }
      if (!storagePath) throw new Error('No free worktree directory available');
      await fs.mkdir(path.dirname(storagePath), { recursive: true });
      const base = await this.resolveBaseRef(repoPath, baseBranch);
      if (base.isEmpty) {
        throw new Error('Cannot create worktree in an empty repository (no commits found)');
      }

      await this.addWorktree(repoPath, branchName, storagePath, base.ref);

      await this.copyWorkspaceFiles(repoPath, storagePath);

      return {
        path: storagePath,
        workspacePath: workdirPrefix ? path.join(storagePath, workdirPrefix) : storagePath,
        branch: branchName,
        baseCommit: base.commit,
      };
    });
  }

  private async copyWorkspaceFiles(repoPath: string, storagePath: string): Promise<void> {
    // 1. Copy env files matching .env*
    try {
      const files = await fs.readdir(repoPath);
      for (const file of files) {
        if (file.startsWith('.env')) {
          const src = path.join(repoPath, file);
          const dest = path.join(storagePath, file);
          await fs.copyFile(src, dest).catch(() => undefined);
        }
      }
    } catch {
      // Ignore errors
    }

    // 2. Read and apply .worktreeinclude if it exists (for custom files/dirs)
    try {
      const includePath = path.join(repoPath, '.worktreeinclude');
      const includeExists = await fs
        .access(includePath)
        .then(() => true)
        .catch(() => false);
      if (includeExists) {
        const content = await fs.readFile(includePath, 'utf8');
        const lines = content
          .split('\n')
          .map((line) => line.trim())
          .filter((line) => line && !line.startsWith('#'));

        for (const line of lines) {
          const src = path.join(repoPath, line);
          const dest = path.join(storagePath, line);
          const stat = await fs.stat(src).catch(() => null);

          if (stat) {
            await fs.mkdir(path.dirname(dest), { recursive: true }).catch(() => undefined);
            if (stat.isDirectory()) {
              // Symlink directories to share dependencies or target directories
              await fs.symlink(src, dest, 'dir').catch(() => undefined);
            } else {
              // Copy individual files
              await fs.copyFile(src, dest).catch(() => undefined);
            }
          }
        }
      }
    } catch {
      // Ignore errors
    }
  }

  async restore(
    repoPath: string,
    branch: string,
    workspacePath: string,
    baseCommit: string,
    workdirPrefix = '',
    allowRecreateBranch = false,
  ): Promise<void> {
    const storagePath = workdirPrefix
      ? path.resolve(
          workspacePath,
          ...workdirPrefix
            .split('/')
            .filter(Boolean)
            .map(() => '..'),
        )
      : workspacePath;
    await this.gitMutex.run(repoPath, async () => {
      const workspaceExists = await fs
        .stat(workspacePath)
        .then((s) => s.isDirectory())
        .catch((err: NodeJS.ErrnoException) => {
          if (err.code !== 'ENOENT') throw err;
          return false;
        });
      if (workspaceExists) return;
      const rootExists = await fs
        .lstat(storagePath)
        .then(() => true)
        .catch((err: NodeJS.ErrnoException) => {
          if (err.code !== 'ENOENT') throw err;
          return false;
        });
      if (rootExists) {
        throw new Error(
          `Workspace folder is missing inside an existing worktree: ${workspacePath}`,
        );
      }
      const git = simpleGit(repoPath);
      const branchExists = (await git.branchLocal()).all.includes(branch);
      if (!branchExists && !allowRecreateBranch) {
        throw new Error(
          `Cannot restore missing worktree: session branch is also missing: ${branch}`,
        );
      }
      if (!branchExists) {
        // An unused draft can be recreated from its original baseline, never
        // silently replace a conversation's missing changes with today's HEAD.
        await git.revparse(['--verify', `${baseCommit}^{commit}`]);
      }
      await fs.mkdir(path.dirname(storagePath), { recursive: true });
      await git.raw(['worktree', 'prune', '--expire', 'now']);
      await git.raw(
        branchExists
          ? ['worktree', 'add', storagePath, branch]
          : ['worktree', 'add', '-b', branch, storagePath, baseCommit],
      );
      await this.copyWorkspaceFiles(repoPath, storagePath);
      if (
        !(await fs
          .stat(workspacePath)
          .then((s) => s.isDirectory())
          .catch(() => false))
      ) {
        throw new Error(`Restored worktree does not contain the selected folder: ${workspacePath}`);
      }
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

  async isCleanWorkspace(repoPath: string, workspacePath: string): Promise<boolean> {
    return this.gitMutex.run(repoPath, async () =>
      (await simpleGit(workspacePath).status()).isClean(),
    );
  }

  async createBranch(repoPath: string, worktreePath: string, name: string): Promise<void> {
    await this.gitMutex.run(repoPath, async () => {
      const git = simpleGit(worktreePath);
      await git.raw(['check-ref-format', '--branch', name]);
      await git.raw(['checkout', '-b', name]);
    });
  }

  async addBranchWorktree(
    repoPath: string,
    sessionId: string,
    branchName: string,
    workdirPrefix = '',
    startPoint?: string,
    existingWorktreePath?: string,
  ): Promise<{ path: string; workspacePath: string }> {
    const projectName = this.sanitize(path.basename(repoPath));
    const cleanSessionId = this.sanitize(sessionId);
    // Reuse an isolated session's checkout so a branch switch does not orphan
    // its original directory or discard copied/ignored workspace files.
    const storagePath = existingWorktreePath
      ? (await simpleGit(existingWorktreePath).revparse(['--show-toplevel'])).trim()
      : path.join(this.baseDir, projectName, `checkout-${cleanSessionId}`);
    if (existingWorktreePath && (await fs.realpath(storagePath)) === (await fs.realpath(repoPath)))
      throw new Error('Branch switching must use an isolated worktree');

    await fs.mkdir(path.dirname(storagePath), { recursive: true });

    return await this.gitMutex.run(repoPath, async () => {
      const git = simpleGit(repoPath);
      await git.raw(['check-ref-format', '--branch', branchName]);
      const occupied = (await this.listWorktrees(repoPath)).find(
        (wt) => wt.branch === branchName && wt.path !== storagePath,
      );
      if (occupied)
        throw new Error(
          'This branch is already checked out. Create a new branch for this workspace.',
        );
      const exists = await fs
        .lstat(storagePath)
        .then(() => true)
        .catch(() => false);
      if (exists) {
        const current = simpleGit(storagePath);
        if (!(await current.status()).isClean())
          throw new Error('Commit or stash changes before switching branches');
        if ((await current.branchLocal()).current === branchName) {
          return {
            path: storagePath,
            workspacePath: workdirPrefix ? path.join(storagePath, workdirPrefix) : storagePath,
          };
        }
        // Git checkout preserves the directory and rejects unsafe transitions.
        await current.raw(
          startPoint ? ['checkout', '-b', branchName, startPoint] : ['checkout', branchName],
        );
      } else {
        await git.raw(
          startPoint
            ? ['worktree', 'add', '-b', branchName, storagePath, startPoint]
            : ['worktree', 'add', storagePath, branchName],
        );
        await this.copyWorkspaceFiles(repoPath, storagePath);
      }

      return {
        path: storagePath,
        workspacePath: workdirPrefix ? path.join(storagePath, workdirPrefix) : storagePath,
      };
    });
  }

  async cleanup(repoPath: string, worktreePath: string, branchName: string): Promise<void> {
    await this.gitMutex.run(repoPath, async () => {
      await this.removeWorktreeAndBranch(repoPath, worktreePath, branchName);
    });
  }

  async removeWorktreeOnly(repoPath: string, worktreePath: string): Promise<void> {
    await this.gitMutex.run(repoPath, async () => {
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

    // Only delete branches we created (agentctl/*), never touch user's real branches
    if (branchName.startsWith('agentctl/')) {
      try {
        await this.deleteBranch(repoPath, branchName);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        if (!message.includes('not found')) {
          throw error;
        }
      }
    }
  }

  async sync(
    repoPath: string,
    activeSessionIds: string[],
    knownSessionIds: string[],
  ): Promise<void> {
    const knownIds = new Set(knownSessionIds.map((id) => this.sanitize(id)));
    const orphans = await this.listOrphans(repoPath, activeSessionIds);
    for (const orphan of orphans) {
      if (!knownIds.has(orphan.branch.split('/')[1])) continue;
      await this.cleanup(repoPath, orphan.path, orphan.branch);
    }
  }

  private review(): SnapshotService {
    return (this.reviewService ??= new SnapshotService(path.join(this.baseDir, '.review-indexes')));
  }

  async getDiff(repoPath: string, worktreePath: string, baseCommit: string): Promise<string> {
    return this.gitMutex.run(repoPath, async () => {
      const files = await this.review().getReviewFiles(worktreePath, baseCommit, {
        scope: 'session',
      });
      return files
        .map((file) => file.diff)
        .filter(Boolean)
        .join('\n');
    });
  }

  async getReviewFiles(
    repoPath: string,
    worktreePath: string,
    baseCommit: string,
  ): Promise<ReviewFile[]> {
    return this.gitMutex.run(repoPath, () =>
      this.review().getReviewFiles(worktreePath, baseCommit, { scope: 'working' }),
    );
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
        const gitWorktree = simpleGit(worktreePath);
        const before = await gitWorktree.status();
        if (before.conflicted.length === 0 && !before.isClean()) {
          const mergeInProgress = await gitWorktree
            .raw(['rev-parse', '-q', '--verify', 'MERGE_HEAD'])
            .then((v) => !!v.trim())
            .catch(() => false);
          if (!mergeInProgress)
            throw new Error('Commit or discard workspace changes before applying the session');
        }

        // Check if there is already a merge in progress (MERGE_HEAD exists)
        let hasMergeHead = false;
        try {
          const mergeHeadPath = (
            await gitWorktree.raw(['rev-parse', '--git-path', 'MERGE_HEAD'])
          ).trim();
          const absMergeHeadPath = path.isAbsolute(mergeHeadPath)
            ? mergeHeadPath
            : path.resolve(worktreePath, mergeHeadPath);
          hasMergeHead = await fs
            .access(absMergeHeadPath)
            .then(() => true)
            .catch(() => false);
        } catch {
          // ignore
        }

        const worktreeStatus = await gitWorktree.status();
        if (worktreeStatus.conflicted.length > 0) {
          throw new Error(
            'Merge conflict occurred. Please resolve conflicts in the sandbox first.',
          );
        }

        if (hasMergeHead) {
          // Conflicts are resolved and staged. We can commit the merge in the worktree.
          try {
            await gitWorktree.commit(`Merge branch '${baseBranch}' into ${branchName}`);
          } catch (commitErr) {
            const msg = commitErr instanceof Error ? commitErr.message : String(commitErr);
            if (!msg.includes('nothing to commit') && !msg.includes('no changes added to commit')) {
              throw commitErr;
            }
          }
        } else {
          // 1. Test merge baseBranch into worktree first to detect conflicts in sandbox
          try {
            await gitWorktree.merge([baseBranch]);
          } catch (mergeErr) {
            const statusAfterMerge = await gitWorktree.status();
            if (statusAfterMerge.conflicted.length > 0) {
              throw new Error(
                'Merge conflict occurred. Please resolve conflicts in the sandbox first.',
              );
            }
            throw mergeErr;
          }
        }

        // 2. Check if the host working tree is clean before applying changes
        const status = await simpleGit(repoPath).status();
        if (!status.isClean()) {
          throw new Error(
            'Working tree is not clean. Please commit or stash your changes before applying.',
          );
        }

        // Save original branch
        const originalBranch = await this.getCurrentBranch(repoPath);

        // 3. Checkout baseBranch in host and apply the clean merge
        const hostHead = (await simpleGit(repoPath).revparse(['HEAD'])).trim();
        await simpleGit(repoPath).checkout(baseBranch);
        const baseHead = (await simpleGit(repoPath).revparse(['HEAD'])).trim();

        try {
          await simpleGit(repoPath).merge(['--squash', branchName]);
          try {
            const staged = (await simpleGit(repoPath).diff(['--cached', '--name-only'])).trim();
            if (staged) {
              await simpleGit(repoPath).commit(commitMessage ?? taskSlug);
              if ((await simpleGit(repoPath).revparse(['HEAD'])).trim() === baseHead) {
                throw new Error('Apply commit failed. Check your commit hooks.');
              }
            }
          } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);
            if (
              !message.includes('nothing to commit') &&
              !message.includes('no changes added to commit')
            ) {
              throw error;
            }
          }
        } catch (err: unknown) {
          // Squash merges do not create MERGE_HEAD. Restore the clean host explicitly.
          await simpleGit(repoPath).raw(['reset', '--hard', baseHead]);
          if (originalBranch && originalBranch !== baseBranch) {
            await simpleGit(repoPath)
              .checkout(originalBranch)
              .catch(() => undefined);
          }
          if (
            (await this.getCurrentBranch(repoPath)) === originalBranch &&
            originalBranch !== baseBranch
          ) {
            await simpleGit(repoPath).raw(['reset', '--hard', hostHead]);
          }
          throw err;
        }

        // Restore original branch
        if (originalBranch && originalBranch !== baseBranch) {
          await simpleGit(repoPath).checkout(originalBranch);
        }
      }

      if (action === 'merge')
        await this.removeWorktreeAndBranch(repoPath, worktreePath, branchName);
    });
  }

  async withRepositoryLock<T>(repoPath: string, task: () => Promise<T>): Promise<T> {
    return this.gitMutex.run(repoPath, task);
  }

  async stageFile(repoPath: string, worktreePath: string, filePath: string): Promise<void> {
    await this.gitMutex.run(repoPath, async () => {
      await resolveWorkspaceFile(worktreePath, filePath);
      await simpleGit(worktreePath).raw(['--literal-pathspecs', 'add', '--', filePath]);
    });
  }

  async revertFile(repoPath: string, worktreePath: string, filePath: string): Promise<void> {
    await this.gitMutex.run(repoPath, async () => {
      const absPath = await resolveWorkspaceFile(worktreePath, filePath);
      const git = simpleGit(worktreePath);
      const tracked =
        (await git.raw(['--literal-pathspecs', 'ls-files', '-z', '--', filePath])).length > 0;
      const inHead = await git
        .raw(['--literal-pathspecs', 'ls-tree', '-z', 'HEAD', '--', filePath])
        .catch(() => '');
      if (inHead) {
        await git.raw([
          '--literal-pathspecs',
          'restore',
          '--source=HEAD',
          '--staged',
          '--worktree',
          '--',
          filePath,
        ]);
      } else {
        if (tracked) await git.raw(['--literal-pathspecs', 'rm', '--cached', '-f', '--', filePath]);
        const stat = await fs.lstat(absPath).catch(() => null);
        if (stat?.isDirectory())
          throw new Error('Discard individual files rather than entire directories');
        await fs.rm(absPath, { force: true });
      }
    });
  }

  async stageAll(repoPath: string, worktreePath: string): Promise<void> {
    await this.gitMutex.run(repoPath, () => simpleGit(worktreePath).raw(['add', '-A', '--', '.']));
  }

  async unstageFile(repoPath: string, worktreePath: string, filePath: string): Promise<void> {
    await this.gitMutex.run(repoPath, async () => {
      await resolveWorkspaceFile(worktreePath, filePath);
      await this.unstagePaths(worktreePath, [filePath]);
    });
  }

  async unstagePaths(worktreePath: string, paths: string[]): Promise<void> {
    const git = simpleGit(worktreePath);
    const hasHead = await git
      .revparse(['--verify', 'HEAD'])
      .then(() => true)
      .catch(() => false);
    await git.raw(
      hasHead
        ? ['--literal-pathspecs', 'reset', 'HEAD', '--', ...paths]
        : ['--literal-pathspecs', 'rm', '--cached', '-r', '--ignore-unmatch', '--', ...paths],
    );
  }

  async unstageAll(repoPath: string, worktreePath: string): Promise<void> {
    await this.gitMutex.run(repoPath, () => this.unstagePaths(worktreePath, ['.']));
  }

  async commit(
    repoPath: string,
    worktreePath: string,
    message: string,
    includeUnstaged = false,
  ): Promise<void> {
    await this.gitMutex.run(repoPath, async () => {
      const git = simpleGit({
        baseDir: worktreePath,
        timeout: { block: 120000, stdErr: false, stdOut: false },
      });
      if (!message.trim()) throw new Error('A commit message is required');
      if (includeUnstaged) await git.raw(['add', '-A', '--', '.']);
      const prefix = (await git.revparse(['--show-prefix'])).trim();
      const stagedPaths = (await git.raw(['diff', '--cached', '--name-only', '-z', '--no-renames']))
        .split('\0')
        .filter(Boolean);
      if (prefix && stagedPaths.some((filePath) => !filePath.startsWith(prefix))) {
        throw new Error(
          'Staged changes outside this project. Unstage them or open the repository root before committing.',
        );
      }
      const before = await git.revparse(['HEAD']).catch(() => '');
      await git.commit(message);
      const after = await git.revparse(['HEAD']).catch(() => '');
      if (after.trim() === before.trim())
        throw new Error('Git did not create a commit. Check staged changes and commit hooks.');
    });
  }

  private async trackingTarget(
    worktreePath: string,
  ): Promise<{ branch: string; remote: string; ref: string; configured: boolean }> {
    const git = simpleGit(worktreePath);
    const branch = await this.getCurrentBranch(worktreePath);
    if (!branch || branch === 'HEAD') throw new Error('Check out a branch before synchronizing');
    const configuredRemote = (
      await git.raw(['config', '--get', `branch.${branch}.remote`]).catch(() => '')
    ).trim();
    const configuredRef = (
      await git.raw(['config', '--get', `branch.${branch}.merge`]).catch(() => '')
    ).trim();
    if (configuredRemote && configuredRef)
      return { branch, remote: configuredRemote, ref: configuredRef, configured: true };
    const remotes = await git.getRemotes();
    const remote = remotes.find((r) => r.name === 'origin') ?? remotes[0];
    if (!remote) throw new Error('No Git remote is configured for this repository');
    return { branch, remote: remote.name, ref: `refs/heads/${branch}`, configured: false };
  }

  async fetch(
    repoPath: string,
    worktreePath: string,
  ): Promise<{ success: boolean; output: string }> {
    return this.gitMutex.run(repoPath, async () => {
      const { remote } = await this.trackingTarget(worktreePath);
      const git = simpleGit({
        baseDir: worktreePath,
        timeout: { block: 120000, stdErr: false, stdOut: false },
      }).env('GIT_TERMINAL_PROMPT', '0');
      await git.fetch(remote, ['--prune']);
      this.fetchedAt.set(repoPath, new Date().toISOString());
      this.prCache.clear();
      return { success: true, output: `Fetched ${remote}` };
    });
  }

  async push(
    repoPath: string,
    worktreePath: string,
  ): Promise<{ success: boolean; output: string }> {
    return this.gitMutex.run(repoPath, async () => {
      const target = await this.trackingTarget(worktreePath);
      const git = simpleGit({
        baseDir: worktreePath,
        timeout: { block: 120000, stdErr: false, stdOut: false },
      }).env('GIT_TERMINAL_PROMPT', '0');
      const result = await git.push([
        ...(target.configured ? [] : ['--set-upstream']),
        target.remote,
        `HEAD:${target.ref}`,
      ]);
      this.prCache.clear();
      return { success: true, output: JSON.stringify(result) };
    });
  }

  async refreshBranch(
    repoPath: string,
    worktreePath: string,
    targetRef: string,
  ): Promise<{ moved: boolean; headCommit: string }> {
    return await this.gitMutex.run(repoPath, async () => {
      const git = simpleGit(worktreePath);
      const headCommit = (await git.revparse(['HEAD'])).trim();
      const targetCommit = (await git.revparse([targetRef])).trim();

      if (headCommit === targetCommit) {
        return { moved: false, headCommit };
      }

      const status = await git.status();
      if (!status.isClean()) {
        throw new Error('Cannot refresh branch: worktree has uncommitted changes');
      }

      const mergeBase = (
        await git.raw(['merge-base', headCommit, targetCommit]).catch(() => '')
      ).trim();
      const isAncestor = mergeBase.length > 0 && mergeBase === headCommit;

      if (!isAncestor) {
        // Record previous commit so nothing is lost if upstream was rewritten (rebase/squash/amend)
        await git.raw(['update-ref', 'refs/agentctl/pre-refresh', headCommit]);
        await git.raw(['reset', '--merge', targetCommit]);
      } else {
        await git.raw(['merge', '--ff-only', targetCommit]);
      }

      const newHead = (await git.revparse(['HEAD'])).trim();
      return { moved: true, headCommit: newHead };
    });
  }

  async pull(
    repoPath: string,
    worktreePath: string,
  ): Promise<{ success: boolean; output: string }> {
    return this.gitMutex.run(repoPath, async () => {
      const target = await this.trackingTarget(worktreePath);
      const git = simpleGit({
        baseDir: worktreePath,
        timeout: { block: 120000, stdErr: false, stdOut: false },
      }).env('GIT_TERMINAL_PROMPT', '0');
      if (!(await git.status()).isClean())
        throw new Error('Cannot pull: worktree has uncommitted changes');
      const before = (await git.revparse(['HEAD'])).trim();
      await git.fetch(target.remote, target.ref);
      this.fetchedAt.set(repoPath, new Date().toISOString());
      const remoteHead = (await git.revparse(['FETCH_HEAD'])).trim();
      const base = (await git.raw(['merge-base', before, remoteHead]).catch(() => '')).trim();
      if (remoteHead === before || base === remoteHead)
        return { success: true, output: 'Already up to date.' };
      if (base !== before)
        throw new Error(
          'Local and remote branches have diverged. Resolve the branch in a terminal before pulling.',
        );
      await git.raw(['merge', '--ff-only', remoteHead]);
      this.prCache.clear();
      return {
        success: true,
        output: `Updated ${before.slice(0, 7)} to ${remoteHead.slice(0, 7)}`,
      };
    });
  }

  async merge(repoPath: string, worktreePath: string, branchName: string): Promise<void> {
    await this.gitMutex.run(repoPath, async () => {
      await simpleGit(worktreePath).merge([branchName]);
    });
  }

  async checkMergeConflicts(
    repoPath: string,
    targetWorktreePath: string,
    sourceBranch: string,
  ): Promise<{ hasConflicts: boolean; conflictingFiles: string[] }> {
    return this.gitMutex.run(repoPath, async () => {
      try {
        const git = simpleGit(targetWorktreePath);
        const targetHead = (await git.revparse(['HEAD'])).trim();
        const sourceHead = (await git.revparse([sourceBranch])).trim();

        const output = await git.raw(['merge-tree', targetHead, sourceHead]).catch(() => null);
        if (!output) {
          return { hasConflicts: false, conflictingFiles: [] };
        }

        const lines = output.split('\n');
        const conflictingFiles: string[] = [];

        for (const line of lines) {
          if (line.includes('CONFLICT') || line.includes('changed in both')) {
            const parts = line.split(':');
            if (parts.length > 1) {
              conflictingFiles.push(parts[parts.length - 1].trim());
            }
          }
        }

        return {
          hasConflicts: conflictingFiles.length > 0 || output.includes('CONFLICT'),
          conflictingFiles: Array.from(new Set(conflictingFiles)),
        };
      } catch {
        return { hasConflicts: false, conflictingFiles: [] };
      }
    });
  }

  async detectPullRequest(
    worktreePath: string,
    branchName?: string,
    repositoryUrl?: string,
  ): Promise<{
    number: number;
    title: string;
    url: string;
    baseBranch: string;
    headBranch: string;
    state: 'open' | 'closed' | 'merged';
  } | null> {
    try {
      const branch = branchName ?? (await this.getCurrentBranch(worktreePath));
      if (!branch) return null;

      const { stdout } = await execFileAsync(
        'gh',
        [
          'pr',
          'view',
          branch,
          ...(repositoryUrl ? ['--repo', repositoryUrl] : []),
          '--json',
          'number,title,url,state,headRefName,baseRefName',
        ],
        { cwd: worktreePath, timeout: 5000 },
      );
      const data = JSON.parse(stdout) as {
        number?: number;
        title?: string;
        url?: string;
        state?: string;
        headRefName?: string;
        baseRefName?: string;
      };
      if (!data.number || !data.url) return null;

      const stateMap: Record<string, 'open' | 'closed' | 'merged'> = {
        OPEN: 'open',
        CLOSED: 'closed',
        MERGED: 'merged',
      };

      return {
        number: data.number,
        title: data.title ?? '',
        url: data.url,
        baseBranch: data.baseRefName ?? 'main',
        headBranch: data.headRefName ?? branch,
        state: stateMap[data.state ?? 'OPEN'] ?? 'open',
      };
    } catch {
      return null;
    }
  }

  async getTrackingStatus(
    repoPath: string,
    worktreePath: string,
  ): Promise<{
    isRepo: boolean;
    branch: string | null;
    hasPrimaryRemote: boolean;
    remoteName: string | null;
    remoteProvider: 'github' | 'other' | null;
    upstreamBranch: string | null;
    hasUpstream: boolean;
    aheadCount: number;
    behindCount: number;
    pr: {
      number: number;
      title: string;
      url: string;
      baseBranch: string;
      headBranch: string;
      state: 'open' | 'closed' | 'merged';
    } | null;
    error?: string;
    lastFetchedAt?: string | null;
  }> {
    const result = await this.gitMutex.run(repoPath, async () => {
      try {
        const git = simpleGit(worktreePath);
        const isRepo = await git.checkIsRepo();
        if (!isRepo) {
          return {
            isRepo: false,
            branch: null,
            hasPrimaryRemote: false,
            remoteName: null,
            remoteProvider: null,
            upstreamBranch: null,
            hasUpstream: false,
            aheadCount: 0,
            behindCount: 0,
            pr: null,
          };
        }

        const currentBranch = await this.getCurrentBranch(worktreePath);
        const remotes = await git.getRemotes(true);
        const configuredRemote = (
          await git.raw(['config', '--get', `branch.${currentBranch}.remote`]).catch(() => '')
        ).trim();
        const primaryRemote =
          remotes.find((remote) => remote.name === configuredRemote) ??
          remotes.find((remote) => remote.name === 'origin') ??
          remotes[0];
        const remoteUrl = primaryRemote?.refs.push || primaryRemote?.refs.fetch || '';
        const hasPrimaryRemote = primaryRemote !== undefined;
        const remoteProvider = hasPrimaryRemote
          ? remoteUrl.includes('github.com')
            ? ('github' as const)
            : ('other' as const)
          : null;

        let upstreamBranch: string | null = null;
        let hasUpstream = false;
        let aheadCount = 0;
        let behindCount = 0;

        if (currentBranch) {
          try {
            const upstream = (await git.raw(['rev-parse', '--abbrev-ref', '@{upstream}'])).trim();
            if (upstream && !upstream.includes('@{upstream}')) {
              upstreamBranch = upstream;
              hasUpstream = true;

              const counts = (
                await git.raw(['rev-list', '--left-right', '--count', 'HEAD...@{upstream}'])
              ).trim();
              const [aheadStr, behindStr] = counts.split(/\s+/);
              aheadCount = parseInt(aheadStr, 10) || 0;
              behindCount = parseInt(behindStr, 10) || 0;
            }
          } catch {
            // No upstream branch configured
          }
        }

        const pr = null;

        return {
          isRepo: true,
          branch: currentBranch,
          hasPrimaryRemote,
          remoteName: primaryRemote?.name ?? null,
          remoteProvider,
          upstreamBranch,
          hasUpstream,
          aheadCount,
          behindCount,
          pr,
        };
      } catch (err: unknown) {
        return {
          isRepo: false,
          branch: null,
          hasPrimaryRemote: false,
          remoteName: null,
          remoteProvider: null,
          upstreamBranch: null,
          hasUpstream: false,
          aheadCount: 0,
          behindCount: 0,
          pr: null,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    });
    // Network PR lookup runs outside the lock used by local Git mutations.
    if (result.isRepo && result.branch && result.remoteProvider === 'github') {
      const git = simpleGit(worktreePath);
      const remotes = await git.getRemotes(true);
      const remote = remotes.find((remote) => remote.name === result.remoteName);
      const repositoryUrl = parseGitHubRemoteUrl(remote?.refs.push || remote?.refs.fetch || '');
      const key = `${repoPath}:${result.branch}:${repositoryUrl}`;
      let cached = this.prCache.get(key);
      if (!cached || cached.expiresAt < Date.now()) {
        if (this.prCache.size > 100) this.prCache.clear();
        cached = {
          expiresAt: Date.now() + 60000,
          value: this.detectPullRequest(worktreePath, result.branch, repositoryUrl ?? undefined),
        };
        this.prCache.set(key, cached);
      }
      return {
        ...result,
        pr: await cached.value,
        lastFetchedAt: this.fetchedAt.get(repoPath) ?? null,
      };
    }
    return { ...result, lastFetchedAt: this.fetchedAt.get(repoPath) ?? null };
  }

  async createPullRequest(
    repoPath: string,
    worktreePath: string,
    params: {
      title: string;
      body?: string;
      baseBranch?: string;
      headBranch?: string;
    },
  ): Promise<
    | {
        status: 'created' | 'already_exists';
        pr: {
          number: number;
          title: string;
          url: string;
          baseBranch: string;
          headBranch: string;
          state: 'open' | 'closed' | 'merged';
        };
      }
    | {
        status: 'needs_browser';
        compareUrl: string;
      }
  > {
    return await this.gitMutex.run(repoPath, async () => {
      const git = simpleGit({
        baseDir: worktreePath,
        timeout: { block: 120000, stdErr: false, stdOut: false },
      }).env('GIT_TERMINAL_PROMPT', '0');
      const head = params.headBranch ?? (await this.getCurrentBranch(worktreePath));
      const base = params.baseBranch ?? (await this.getCurrentBranch(repoPath)) ?? 'main';

      if (!head || head === 'HEAD') {
        throw new Error('Cannot create a pull request from a detached HEAD');
      }
      if (!base.trim()) {
        throw new Error('A base branch is required');
      }
      if (head === base) {
        throw new Error('The head and base branches must be different');
      }

      const worktreeStatus = await git.status();
      if (!worktreeStatus.isClean()) {
        throw new Error(
          'Commit or discard all working tree changes before creating a pull request',
        );
      }

      const remotes = await git.getRemotes(true);
      const target = await this.trackingTarget(worktreePath);
      const primaryRemote = remotes.find((remote) => remote.name === target.remote);
      if (!primaryRemote) {
        throw new Error('No Git remote is configured for this repository');
      }
      const remoteUrl = primaryRemote.refs.push || primaryRemote.refs.fetch || '';
      const repoWebUrl = parseGitHubRemoteUrl(remoteUrl);
      if (!repoWebUrl) {
        throw new Error('Pull request creation currently supports GitHub remotes only');
      }

      await git.push([primaryRemote.name, `refs/heads/${head}:refs/heads/${head}`]);
      this.prCache.clear();

      const existingPr = await this.detectPullRequest(worktreePath, head, repoWebUrl);
      if (existingPr?.state === 'open') {
        return { status: 'already_exists', pr: existingPr };
      }

      try {
        const args = [
          'pr',
          'create',
          '--repo',
          repoWebUrl,
          '--title',
          params.title,
          '--base',
          base,
          '--head',
          head,
        ];
        if (params.body) {
          args.push('--body', params.body);
        }
        const { stdout } = await execFileAsync('gh', args, {
          cwd: worktreePath,
          timeout: 15000,
        });

        const prUrl = stdout.trim().split('\n').pop()?.trim() ?? '';
        const prNumberMatch = /\/pull\/(\d+)/.exec(prUrl);
        if (!prNumberMatch) {
          throw new Error('GitHub CLI did not return a pull request URL');
        }
        const prNumber = parseInt(prNumberMatch[1], 10);

        return {
          status: 'created',
          pr: {
            number: prNumber,
            title: params.title,
            url: prUrl,
            baseBranch: base,
            headBranch: head,
            state: 'open',
          },
        };
      } catch {
        const query = new URLSearchParams({
          expand: '1',
          title: params.title,
          ...(params.body ? { body: params.body } : {}),
        });
        return {
          status: 'needs_browser',
          compareUrl: `${repoWebUrl}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}?${query.toString()}`,
        };
      }
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
export type { Workspace as WorkspaceHandle };
