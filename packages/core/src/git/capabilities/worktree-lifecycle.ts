import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { simpleGit } from 'simple-git';
import type { GitMutex } from '../mutex.js';
import type { GitRepositoryQueries } from './repository-queries.js';
import type { WorktreeResult, ListedWorktree, WorkspaceStorage } from './types.js';
import { assertNoGitOperation, assertIgnoredFilesSafe } from './workspace-safety.js';
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

export class GitWorktreeLifecycle {
  constructor(
    private readonly gitMutex: GitMutex,
    private readonly storage: WorkspaceStorage,
    private readonly queries: Pick<GitRepositoryQueries, 'resolveBaseRef'>,
  ) {}
  private sanitize(input: string): string {
    return input.replace(/[^a-zA-Z0-9-]/g, '-').replace(/-+/g, '-');
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

  /** Read helper for already locked lifecycle/integration workflows; never reacquires the lock. */
  async listWorktrees(repoPath: string): Promise<ListedWorktree[]> {
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
        const candidatePath = path.join(this.storage.baseDir, projectName, folderName);
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
      const base = await this.queries.resolveBaseRef(repoPath, baseBranch);
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
      : path.join(this.storage.baseDir, projectName, `checkout-${cleanSessionId}`);
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
        await assertNoGitOperation(storagePath);
        const incomingRef = startPoint ?? `refs/heads/${branchName}`;
        await assertIgnoredFilesSafe(storagePath, incomingRef);
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
}
