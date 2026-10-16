import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { simpleGit } from 'simple-git';
import type { GitMutex } from '../mutex.js';
import type { GitRepositoryQueries } from './repository-queries.js';
import type { GitWorktreeLifecycle } from './worktree-lifecycle.js';
import type { WorkspaceStorage } from './types.js';
import { assertNoGitOperation, assertIgnoredFilesSafe } from './workspace-safety.js';
const execFileAsync = promisify(execFile);
export class GitBranchIntegration {
  constructor(
    private readonly gitMutex: GitMutex,
    private readonly storage: WorkspaceStorage,
    private readonly queries: Pick<GitRepositoryQueries, 'getCurrentBranch'>,
    private readonly worktrees: Pick<GitWorktreeLifecycle, 'listWorktrees'>,
  ) {}
  async checkout(repoPath: string, ref: string): Promise<void> {
    await this.gitMutex.run(repoPath, async () => {
      await simpleGit(repoPath).checkout(ref);
    });
  }

  async createBranch(repoPath: string, worktreePath: string, name: string): Promise<void> {
    await this.gitMutex.run(repoPath, async () => {
      const git = simpleGit(worktreePath);
      await git.raw(['check-ref-format', '--branch', name]);
      await git.raw(['checkout', '-b', name]);
    });
  }

  private async mergeDestination(repoPath: string, baseBranch: string) {
    const git = simpleGit(repoPath);
    await git.raw(['check-ref-format', '--branch', baseBranch]);
    const head = (await git.revparse(['--verify', `refs/heads/${baseBranch}^{commit}`])).trim();
    if (!/^[0-9a-f]{40,64}$/i.test(head))
      throw new Error(`Cannot resolve destination branch ${baseBranch}`);
    const checkout = (await this.worktrees.listWorktrees(repoPath)).find(
      (wt) => wt.branch === baseBranch,
    );
    return { head, path: checkout?.path };
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
      if ((await this.queries.getCurrentBranch(worktreePath)) !== branchName)
        throw new Error('The workspace branch has changed. Refresh the session before merging.');
      const destination = await this.mergeDestination(repoPath, baseBranch);
      const status = await git.status();
      const prefix = (await git.revparse(['--show-prefix'])).trim();
      const outsideProject = !!prefix && status.files.some((file) => !file.path.startsWith(prefix));
      const hasMergeHead = await git
        .raw(['rev-parse', '-q', '--verify', 'MERGE_HEAD'])
        .then((value) => !!value.trim())
        .catch(() => false);
      await assertNoGitOperation(worktreePath, hasMergeHead);
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
        await assertNoGitOperation(destination.path);
      }
      try {
        await assertIgnoredFilesSafe(worktreePath, destination.head);
        if (destination.path)
          await assertIgnoredFilesSafe(destination.path, 'refs/heads/' + branchName);
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
      if ((await this.queries.getCurrentBranch(worktreePath)) !== branchName)
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
          if ((await this.queries.getCurrentBranch(destination.path)) !== baseBranch)
            throw new Error('The destination checkout changed branches. Refresh and retry.');
          if (!(await simpleGit(destination.path).status()).isClean())
            throw new Error(
              `Working tree is not clean. Commit or stash changes in ${baseBranch} at ${destination.path} before merging.`,
            );
          await assertNoGitOperation(destination.path);
        } else if (
          (await this.worktrees.listWorktrees(repoPath)).some((wt) => wt.branch === baseBranch)
        ) {
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
      await assertNoGitOperation(worktreePath, hasMergeHead);
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
      await assertNoGitOperation(worktreePath);
      await assertIgnoredFilesSafe(worktreePath, destination.head);
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
      await assertNoGitOperation(worktreePath);
      if (!(await git.status()).isClean())
        throw new Error(
          'The workspace changed while preparing the merge. Commit or discard workspace changes and retry.',
        );
      if ((await this.queries.getCurrentBranch(worktreePath)) !== branchName)
        throw new Error(
          'The workspace branch changed while preparing the merge. Refresh and retry.',
        );
      const sourceHead = (await git.revparse(['HEAD'])).trim();
      await fs.mkdir(this.storage.baseDir, { recursive: true });
      const integrationPath = await fs.mkdtemp(path.join(this.storage.baseDir, '.apply-'));
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
            (await this.queries.getCurrentBranch(worktreePath)) !== branchName ||
            (await git.revparse(['HEAD'])).trim() !== sourceHead ||
            !(await git.status()).isClean()
          )
            throw new Error(
              'The source workspace changed while preparing the merge. Your work is kept. Refresh and retry.',
            );
          if (destination.path) {
            await assertIgnoredFilesSafe(destination.path, appliedHead);
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
      await assertNoGitOperation(worktreePath);
      await assertIgnoredFilesSafe(worktreePath, targetCommit);
      await git.raw(['merge', '--ff-only', '--no-overwrite-ignore', targetCommit]);

      const newHead = (await git.revparse(['HEAD'])).trim();
      return { moved: true, headCommit: newHead };
    });
  }

  async merge(repoPath: string, worktreePath: string, branchName: string): Promise<void> {
    await this.gitMutex.run(repoPath, async () => {
      const git = simpleGit(worktreePath);
      if (!(await git.status()).isClean())
        throw new Error('Commit or stash workspace changes before merging another branch.');
      await assertNoGitOperation(worktreePath);
      const sourceHead = (
        await git.revparse(['--verify', '--end-of-options', `${branchName}^{commit}`])
      ).trim();
      await assertIgnoredFilesSafe(worktreePath, sourceHead);
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
}
