import { GitHubPullRequests, parseGitHubRemoteUrl } from '../forge/github-pull-requests.js';
import type { PullRequestHost } from '../forge/types.js';
import { resolveRepositoryContext, type RepositoryContext } from './repository-context.js';
import type { GitMutex } from './mutex.js';
import { simpleGit } from 'simple-git';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import { constants } from 'node:fs';
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

export { parseGitHubRemoteUrl } from '../forge/github-pull-requests.js';

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
    private readonly pullRequests: PullRequestHost = new GitHubPullRequests(),
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

  private async removeWorktree(
    repoPath: string,
    worktreePath: string,
    force = true,
  ): Promise<void> {
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
    await simpleGit(repoPath).raw(['worktree', 'remove', ...(force ? ['--force'] : []), rootPath]);
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
          await fs.copyFile(src, dest, constants.COPYFILE_EXCL).catch(() => undefined);
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
              await fs.copyFile(src, dest, constants.COPYFILE_EXCL).catch(() => undefined);
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
        await this.assertNoGitOperation(storagePath);
        const incomingRef = startPoint ?? `refs/heads/${branchName}`;
        await this.assertIgnoredFilesSafe(storagePath, incomingRef);
        await current.raw(
          startPoint
            ? ['checkout', '--no-overwrite-ignore', '-b', branchName, startPoint]
            : ['checkout', '--no-overwrite-ignore', branchName],
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
        if ((await fs.stat(worktreePath).catch(() => null))?.isDirectory()) {
          const root = (await simpleGit(worktreePath).revparse(['--show-toplevel'])).trim();
          if (
            await simpleGit(root).raw([
              'ls-files',
              '--others',
              '--ignored',
              '--exclude-standard',
              '-z',
            ])
          )
            throw new Error(
              'This worktree contains ignored local files. Move them to the project before switching workspace mode. Your worktree has been kept.',
            );
        }
        await this.removeWorktree(repoPath, worktreePath, false);
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

  private async mergeDestination(repoPath: string, baseBranch: string) {
    const git = simpleGit(repoPath);
    await git.raw(['check-ref-format', '--branch', baseBranch]);
    const head = (await git.revparse(['--verify', `refs/heads/${baseBranch}^{commit}`])).trim();
    if (!/^[0-9a-f]{40,64}$/i.test(head))
      throw new Error(`Cannot resolve destination branch ${baseBranch}`);
    const checkout = (await this.listWorktrees(repoPath)).find((wt) => wt.branch === baseBranch);
    return { head, path: checkout?.path };
  }

  private async assertNoGitOperation(worktreePath: string, allowMergeHead = false): Promise<void> {
    const git = simpleGit(worktreePath);
    for (const marker of [
      'MERGE_HEAD',
      'CHERRY_PICK_HEAD',
      'REVERT_HEAD',
      'rebase-merge',
      'rebase-apply',
    ]) {
      if (allowMergeHead && marker === 'MERGE_HEAD') continue;
      const markerPath = (await git.raw(['rev-parse', '--git-path', marker])).trim();
      if (
        await fs
          .access(path.resolve(worktreePath, markerPath))
          .then(() => true)
          .catch(() => false)
      ) {
        throw new Error(`Finish or abort the Git operation in ${worktreePath} before merging.`);
      }
    }
  }

  private async assertIgnoredFilesSafe(worktreePath: string, incomingRef: string): Promise<void> {
    const root = (await simpleGit(worktreePath).revparse(['--show-toplevel'])).trim();
    const git = simpleGit(root);
    const ignored = (
      await git.raw(['ls-files', '--others', '--ignored', '--exclude-standard', '-z'])
    )
      .split('\0')
      .filter(Boolean);
    if (!ignored.length) return;
    const incoming = new Set(
      (await git.raw(['ls-tree', '-r', '--name-only', '-z', incomingRef]))
        .split('\0')
        .filter(Boolean),
    );
    const directories = new Set<string>();
    for (const file of incoming) {
      let index = file.indexOf('/');
      while (index !== -1) {
        directories.add(file.slice(0, index));
        index = file.indexOf('/', index + 1);
      }
    }
    for (const file of ignored) {
      let collision = incoming.has(file) || directories.has(file);
      let index = file.indexOf('/');
      while (!collision && index !== -1) {
        collision = incoming.has(file.slice(0, index));
        index = file.indexOf('/', index + 1);
      }
      if (collision)
        throw new Error(
          `The merge would overwrite ignored file ${file} in ${root}. Move or rename it, then retry. Your files have been kept.`,
        );
    }
  }

  async getMergePreview(
    repoPath: string,
    worktreePath: string,
    branchName: string,
    baseBranch: string,
  ) {
    return this.gitMutex.run(repoPath, async () => {
      if (branchName === baseBranch)
        throw new Error('The session branch and destination branch must be different.');
      const git = simpleGit(worktreePath);
      if ((await this.getCurrentBranch(worktreePath)) !== branchName)
        throw new Error('The workspace branch has changed. Refresh the session before merging.');
      const destination = await this.mergeDestination(repoPath, baseBranch);
      const status = await git.status();
      const prefix = (await git.revparse(['--show-prefix'])).trim();
      const outsideProject = !!prefix && status.files.some((file) => !file.path.startsWith(prefix));
      const hasMergeHead = await git
        .raw(['rev-parse', '-q', '--verify', 'MERGE_HEAD'])
        .then((value) => !!value.trim())
        .catch(() => false);
      await this.assertNoGitOperation(worktreePath, hasMergeHead);
      let blockedReason: string | null = null;
      if (status.conflicted.length)
        blockedReason =
          'Resolve the conflicted files in this worktree and stage each resolution, then retry.';
      else if (outsideProject)
        blockedReason =
          'There are changes outside this project folder. Open the repository root to commit them before merging.';
      else if (hasMergeHead && status.files.some((file) => file.working_dir !== ' '))
        blockedReason =
          'Stage all conflict resolutions and commit or discard any other workspace edits before merging.';
      if (destination.path) {
        if (!(await simpleGit(destination.path).status()).isClean())
          blockedReason = `Commit or stash changes in ${baseBranch} at ${destination.path} before merging. Your files have been kept.`;
        await this.assertNoGitOperation(destination.path);
      }
      try {
        await this.assertIgnoredFilesSafe(worktreePath, destination.head);
        if (destination.path)
          await this.assertIgnoredFilesSafe(destination.path, 'refs/heads/' + branchName);
      } catch (error) {
        blockedReason = error instanceof Error ? error.message : String(error);
      }
      // A staged conflict resolution is deliberately different from HEAD; it
      // will be committed before checking the destination again during finalize.
      const conflicts = hasMergeHead
        ? { hasConflicts: status.conflicted.length > 0, conflictingFiles: status.conflicted }
        : await this.mergeConflicts(worktreePath, destination.head);
      return {
        baseBranch,
        targetPath: destination.path ?? null,
        uncommittedCount: status.files.length,
        hasMergeHead,
        blockedReason,
        ...conflicts,
      };
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
      if (action !== 'merge') return;
      if (branchName === baseBranch)
        throw new Error('The session branch and destination branch must be different.');
      const git = simpleGit(worktreePath);
      if ((await this.getCurrentBranch(worktreePath)) !== branchName)
        throw new Error('The workspace branch has changed. Refresh the session before merging.');
      // Validate the destination before modifying even the source worktree.
      const destination = await this.mergeDestination(repoPath, baseBranch);
      const assertDestination = async () => {
        if (
          (await simpleGit(repoPath).revparse([`refs/heads/${baseBranch}`])).trim() !==
          destination.head
        )
          throw new Error(
            `${baseBranch} changed while preparing the merge. Retry with the latest changes.`,
          );
        if (destination.path) {
          if ((await this.getCurrentBranch(destination.path)) !== baseBranch)
            throw new Error('The destination checkout changed branches. Refresh and retry.');
          if (!(await simpleGit(destination.path).status()).isClean())
            throw new Error(
              `Working tree is not clean. Commit or stash changes in ${baseBranch} at ${destination.path} before merging.`,
            );
          await this.assertNoGitOperation(destination.path);
        } else if ((await this.listWorktrees(repoPath)).some((wt) => wt.branch === baseBranch)) {
          throw new Error(
            'The destination branch was checked out while preparing the merge. Retry.',
          );
        }
      };
      await assertDestination();
      const before = await git.status();
      if (before.conflicted.length)
        throw new Error(
          'Merge conflict occurred. Resolve conflicts in this worktree and stage each resolution before retrying.',
        );
      const hasMergeHead = await git
        .raw(['rev-parse', '-q', '--verify', 'MERGE_HEAD'])
        .then((value) => !!value.trim())
        .catch(() => false);
      await this.assertNoGitOperation(worktreePath, hasMergeHead);
      if (hasMergeHead) {
        if (before.files.some((file) => file.working_dir !== ' '))
          throw new Error(
            'Stage all conflict resolutions and commit or discard any other workspace edits before merging.',
          );
        const previousHead = (await git.revparse(['HEAD'])).trim();
        await git.commit(`Merge branch '${baseBranch}' into ${branchName}`);
        if ((await git.revparse(['HEAD'])).trim() === previousHead)
          throw new Error('Git did not commit the conflict resolutions. Check your commit hooks.');
      } else if (!before.isClean()) {
        throw new Error('Commit or discard workspace changes before applying the session');
      }
      await this.assertNoGitOperation(worktreePath);
      await this.assertIgnoredFilesSafe(worktreePath, destination.head);
      // Conflicts stay in the isolated source worktree for review and recovery.
      try {
        await git.merge(['--no-overwrite-ignore', destination.head]);
      } catch (error) {
        if ((await git.status()).conflicted.length)
          throw new Error(
            'Merge conflict occurred. Resolve conflicts in this worktree and stage each resolution before retrying.',
          );
        throw error;
      }
      await this.assertNoGitOperation(worktreePath);
      if (!(await git.status()).isClean())
        throw new Error(
          'The workspace changed while preparing the merge. Commit or discard workspace changes and retry.',
        );
      if ((await this.getCurrentBranch(worktreePath)) !== branchName)
        throw new Error(
          'The workspace branch changed while preparing the merge. Refresh and retry.',
        );
      const sourceHead = (await git.revparse(['HEAD'])).trim();
      await fs.mkdir(this.baseDir, { recursive: true });
      const integrationPath = await fs.mkdtemp(path.join(this.baseDir, '.apply-'));
      await simpleGit(repoPath).raw([
        'worktree',
        'add',
        '--detach',
        integrationPath,
        destination.head,
      ]);
      const integration = simpleGit({
        baseDir: integrationPath,
        timeout: { block: 120000, stdErr: false, stdOut: false },
      });
      try {
        // Build the squash commit away from every user checkout. Hook failures
        // never require a destructive reset of the destination's files/index.
        await integration.merge(['--squash', sourceHead]);
        const staged = (await integration.diff(['--cached', '--name-only'])).trim();
        if (staged) {
          await integration.commit(commitMessage?.trim() || taskSlug);
          const appliedHead = (await integration.revparse(['HEAD'])).trim();
          if (appliedHead === destination.head)
            throw new Error('Git did not create the merge commit. Check your commit hooks.');
          await assertDestination();
          if (
            (await this.getCurrentBranch(worktreePath)) !== branchName ||
            (await git.revparse(['HEAD'])).trim() !== sourceHead ||
            !(await git.status()).isClean()
          )
            throw new Error(
              'The source workspace changed while preparing the merge. Your work is kept. Refresh and retry.',
            );
          if (destination.path) {
            await this.assertIgnoredFilesSafe(destination.path, appliedHead);
            const target = simpleGit(destination.path);
            try {
              await target.merge(['--ff-only', '--no-overwrite-ignore', appliedHead]);
            } catch (error) {
              // A post-merge hook can fail after the fast-forward succeeded.
              if ((await target.revparse(['HEAD'])).trim() !== appliedHead) throw error;
            }
          } else {
            await simpleGit(repoPath).raw([
              'update-ref',
              `refs/heads/${baseBranch}`,
              appliedHead,
              destination.head,
            ]);
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(
          `${message} Your session worktree is kept. Merge preparation is available at ${integrationPath}.`,
          { cause: error },
        );
      }
      // Cleanup is best effort after a durable merge. Never remove files added
      // by a hook, including ignored files, and never turn success into failure.
      try {
        const ignored = await integration.raw([
          'ls-files',
          '--others',
          '--ignored',
          '--exclude-standard',
          '-z',
        ]);
        if ((await integration.status()).isClean() && !ignored)
          await simpleGit(repoPath).raw(['worktree', 'remove', integrationPath]);
      } catch {
        /* Keep the preparation worktree for recovery. */
      }
      // Retain the source branch, commits, and ignored files until the user
      // explicitly deletes the session. A squash does not retain its history.
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

      if (!isAncestor)
        throw new Error(
          'Cannot refresh branch: local and target history have diverged. Merge the target into this worktree to keep your commits.',
        );
      await this.assertNoGitOperation(worktreePath);
      await this.assertIgnoredFilesSafe(worktreePath, targetCommit);
      await git.raw(['merge', '--ff-only', '--no-overwrite-ignore', targetCommit]);

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
      await this.assertNoGitOperation(worktreePath);
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
      await this.assertIgnoredFilesSafe(worktreePath, remoteHead);
      await git.raw(['merge', '--ff-only', '--no-overwrite-ignore', remoteHead]);
      this.prCache.clear();
      return {
        success: true,
        output: `Updated ${before.slice(0, 7)} to ${remoteHead.slice(0, 7)}`,
      };
    });
  }

  async merge(repoPath: string, worktreePath: string, branchName: string): Promise<void> {
    await this.gitMutex.run(repoPath, async () => {
      const git = simpleGit(worktreePath);
      if (!(await git.status()).isClean())
        throw new Error('Commit or stash workspace changes before merging another branch.');
      await this.assertNoGitOperation(worktreePath);
      const sourceHead = (
        await git.revparse(['--verify', '--end-of-options', `${branchName}^{commit}`])
      ).trim();
      await this.assertIgnoredFilesSafe(worktreePath, sourceHead);
      await git.merge(['--no-overwrite-ignore', sourceHead]);
    });
  }

  private async mergeConflicts(
    worktreePath: string,
    sourceRef: string,
  ): Promise<{ hasConflicts: boolean; conflictingFiles: string[] }> {
    const git = simpleGit(worktreePath);
    const targetHead = (await git.revparse(['HEAD'])).trim();
    const sourceHead = (await git.revparse(['--verify', `${sourceRef}^{commit}`])).trim();
    const args = ['merge-tree', '--write-tree', '--name-only', '-z', targetHead, sourceHead];
    let stdout: string;
    let hasConflicts = false;
    try {
      stdout = (
        await execFileAsync('git', args, { cwd: worktreePath, maxBuffer: 16 * 1024 * 1024 })
      ).stdout;
    } catch (error) {
      const failure = error as { code?: number; stdout?: string };
      // Exit 1 is a real conflict; all other failures must reach the caller.
      if (failure.code !== 1 || !failure.stdout) throw error;
      stdout = failure.stdout;
      hasConflicts = true;
    }
    const fields = stdout.split('\0');
    if (!/^[0-9a-f]{40,64}$/i.test(fields[0]))
      throw new Error('Git returned an invalid merge preview');
    const end = fields.indexOf('', 1);
    const conflictingFiles = hasConflicts ? fields.slice(1, end < 0 ? undefined : end) : [];
    return { hasConflicts, conflictingFiles: [...new Set(conflictingFiles)] };
  }

  async checkMergeConflicts(
    repoPath: string,
    targetWorktreePath: string,
    sourceBranch: string,
  ): Promise<{ hasConflicts: boolean; conflictingFiles: string[] }> {
    return this.gitMutex.run(repoPath, () => this.mergeConflicts(targetWorktreePath, sourceBranch));
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
      return await this.pullRequests.find(worktreePath, branch, repositoryUrl);
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
          ? parseGitHubRemoteUrl(remoteUrl) !== null
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
      const currentBranch = await this.getCurrentBranch(worktreePath);
      const head = params.headBranch ?? currentBranch;
      if (head !== currentBranch)
        throw new Error(
          'The workspace branch changed. Refresh and review the current branch before publishing.',
        );
      const base = (params.baseBranch ?? (await this.getCurrentBranch(repoPath)) ?? 'main').trim();

      if (!head || head === 'HEAD') {
        throw new Error('Cannot create a pull request from a detached HEAD');
      }
      if (!base.trim()) {
        throw new Error('A base branch is required');
      }
      if (head === base) {
        throw new Error('The head and base branches must be different');
      }

      await git.raw(['check-ref-format', '--branch', head]);
      await git.raw(['check-ref-format', '--branch', base]);
      await this.assertNoGitOperation(worktreePath);

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

      await git.push([
        ...(target.configured ? [] : ['--set-upstream']),
        primaryRemote.name,
        `refs/heads/${head}:refs/heads/${head}`,
      ]);
      this.prCache.clear();

      const existingPr = await this.detectPullRequest(worktreePath, head, repoWebUrl);
      if (existingPr?.state === 'open' && existingPr.baseBranch === base) {
        return { status: 'already_exists', pr: existingPr };
      }

      return this.pullRequests.create(worktreePath, repoWebUrl, {
        title: params.title,
        body: params.body,
        base,
        head,
      });
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
