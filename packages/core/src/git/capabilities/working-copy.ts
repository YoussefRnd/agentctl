import fs from 'node:fs/promises';
import { simpleGit } from 'simple-git';
import type { GitMutex } from '../mutex.js';
import { resolveWorkspaceFile } from '../file-safety.js';
export class GitWorkingCopy {
  constructor(private readonly gitMutex: GitMutex) {}
  async isCleanWorkspace(repoPath: string, workspacePath: string): Promise<boolean> {
    return this.gitMutex.run(repoPath, async () =>
      (await simpleGit(workspacePath).status()).isClean(),
    );
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

  /** Caller holds the repository mutation lock; used by compound apply/restore workflows. */
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
}
