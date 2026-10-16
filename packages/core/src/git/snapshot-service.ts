import { GitSnapshotComparison } from './snapshot-comparison.js';
import type { FilePatch, SnapshotFileChange, SnapshotComparison } from './snapshot-types.js';
export type { FilePatch, SnapshotFileChange, SnapshotComparison } from './snapshot-types.js';
import { resolveRepositoryContext } from './repository-context.js';
import type { ReviewResponse, ReviewDiffScope } from '@agentctl/shared';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { simpleGit } from 'simple-git';
import { type ReviewFile, parseFileStatus } from './utils.js';
import { GitMutex } from './mutex.js';
import { resolveWorkspaceFile } from './file-safety.js';

export interface RestoreResult {
  backupHash: string;
  restoredFiles: SnapshotFileChange[];
}

export type { ReviewCapture } from '@agentctl/shared';
export type SnapshotReview = ReviewResponse;

type ReviewOptions = {
  includeDiffs?: boolean;
  filePath?: string;
  scope?: ReviewDiffScope;
};

export class SnapshotRestoreError extends Error {
  constructor(
    readonly backupHash: string,
    cause: unknown,
    readonly rollbackError?: unknown,
  ) {
    const message = cause instanceof Error ? cause.message : String(cause);
    const recovery =
      rollbackError === undefined
        ? 'The previous files were restored.'
        : `Rollback also failed: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}. Files may be partially restored.`;
    super(`Restore failed: ${message}. ${recovery} Recovery snapshot: ${backupHash}`, { cause });
    this.name = 'SnapshotRestoreError';
  }
}

interface SnapshotContext {
  projectPath: string;
  projectPrefix: string;
  repositoryRoot: string;
  userIndexPath: string;
  env: Record<string, string>;
  lockKey: string;
  anchorRef: string;
}

export class SnapshotService {
  private baseDir: string;
  private readonly mutex = new GitMutex();

  private readonly comparison: GitSnapshotComparison;

  constructor(baseDir?: string, options: { maxDiffBytes?: number } = {}) {
    const maxDiffBytes = options.maxDiffBytes ?? 1024 * 1024;
    if (!Number.isSafeInteger(maxDiffBytes) || maxDiffBytes <= 0) {
      throw new Error('maxDiffBytes must be a positive safe integer');
    }
    this.comparison = new GitSnapshotComparison(maxDiffBytes);
    this.baseDir = baseDir ?? path.join(os.homedir(), '.local', 'share', 'agentctl', 'snapshots');
  }

  private projectHash(projectPath: string): string {
    return crypto.createHash('sha256').update(projectPath).digest('hex').substring(0, 16);
  }

  private async getContext(projectPath: string): Promise<SnapshotContext | null> {
    const repository = await resolveRepositoryContext(projectPath).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return null;
        throw error;
      },
    );
    if (!repository?.isGitRepo) return null;
    const canonicalProjectPath = repository.selectedPath;
    const repositoryRoot = repository.repoRoot;
    const projectPrefix = repository.workdirPrefix;
    const hash = this.projectHash(canonicalProjectPath);
    const indexFile = path.join(this.baseDir, hash, 'index');
    await fs.mkdir(path.dirname(indexFile), { recursive: true });

    return {
      projectPath: canonicalProjectPath,
      projectPrefix,
      repositoryRoot,
      userIndexPath: repository.indexPath,
      lockKey: canonicalProjectPath,
      anchorRef: `refs/agentctl/snapshots/${hash}`,
      env: {
        GIT_DIR: repository.gitDir,
        GIT_WORK_TREE: canonicalProjectPath,
        GIT_INDEX_FILE: indexFile,
        GIT_AUTHOR_NAME: 'agentctl',
        GIT_AUTHOR_EMAIL: 'snapshots@agentctl.local',
        GIT_COMMITTER_NAME: 'agentctl',
        GIT_COMMITTER_EMAIL: 'snapshots@agentctl.local',
      },
    };
  }

  async track(projectPath: string): Promise<string | undefined> {
    const context = await this.getContext(projectPath);
    if (!context) {
      return undefined;
    }
    return this.mutex.run(context.lockKey, () => this.trackUnlocked(context));
  }

  private async trackUnlocked(context: SnapshotContext, anchor = true): Promise<string> {
    // Use Git's real worktree scope and index membership for ignore handling.
    // The private index is refreshed from the user's index, which we never write.
    const git = simpleGit(context.repositoryRoot).env({
      ...context.env,
      GIT_WORK_TREE: context.repositoryRoot,
    });
    await fs
      .copyFile(context.userIndexPath, context.env.GIT_INDEX_FILE)
      .catch(async (error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error;
        await git.raw(['read-tree', '--empty']);
      });
    await git.raw(['--literal-pathspecs', 'add', '-A', '--', context.projectPrefix || '.']);
    const repositoryTree = await git
      .raw(['write-tree'])
      .then((value) => value.trim())
      .catch(async (error: unknown) => {
        if (!context.projectPrefix) throw error;
        // Unmerged entries outside this project cannot affect its snapshot.
        // Remove only those entries from the private index, leaving the user index untouched.
        const unmerged = await git.raw(['ls-files', '--unmerged', '-z']);
        const outside = [
          ...new Set(
            unmerged
              .split('\0')
              .filter(Boolean)
              .map((record) => record.slice(record.indexOf('\t') + 1)),
          ),
        ].filter((filePath) => !filePath.startsWith(`${context.projectPrefix}/`));
        if (outside.length === 0) throw error;
        await git.raw(['update-index', '--force-remove', '--', ...outside]);
        return (await git.raw(['write-tree'])).trim();
      });
    const treeHash = context.projectPrefix
      ? await this.projectTree(git, context, repositoryTree)
      : repositoryTree;
    if (!/^[0-9a-f]{40,64}$/i.test(treeHash)) {
      throw new Error('Git returned an invalid snapshot tree hash');
    }

    if (anchor) await this.anchorSnapshot(git, context.anchorRef, treeHash);
    return treeHash;
  }

  private async anchorSnapshot(
    git: ReturnType<typeof simpleGit>,
    anchorRef: string,
    treeHash: string,
  ): Promise<void> {
    const previousCommit = await git
      .raw(['rev-parse', '--verify', anchorRef])
      .then((value) => value.trim())
      .catch(() => '');
    if (previousCommit) {
      const previousTree = (await git.raw(['rev-parse', `${previousCommit}^{tree}`])).trim();
      if (previousTree === treeHash) {
        return;
      }
    }

    const args = ['commit-tree', treeHash, '-m', 'agentctl snapshot'];
    if (previousCommit) {
      args.push('-p', previousCommit);
    }
    const commitHash = (await git.raw(args)).trim();
    await git.raw([
      'update-ref',
      anchorRef,
      commitHash,
      ...(previousCommit ? [previousCommit] : []),
    ]);
  }

  async diff(projectPath: string, fromHash: string): Promise<FilePatch[]> {
    const comparison = await this.compareSnapshots(projectPath, fromHash);
    return comparison.files.map(({ path: filePath, status }) => ({ path: filePath, status }));
  }

  async diffBetween(projectPath: string, fromHash: string, toHash: string): Promise<FilePatch[]> {
    const comparison = await this.compareSnapshots(projectPath, fromHash, toHash);
    return comparison.files.map(({ path: filePath, status }) => ({ path: filePath, status }));
  }

  async compareSnapshots(
    projectPath: string,
    fromHash: string,
    toHash?: string,
  ): Promise<SnapshotComparison> {
    if (!fromHash) {
      throw new Error('A source snapshot hash is required');
    }

    const context = await this.getContext(projectPath);
    if (!context) {
      return { files: [], totalAdditions: 0, totalDeletions: 0 };
    }
    const git = simpleGit(context.projectPath).env(context.env);
    const trees = await this.mutex.run(context.lockKey, async () => {
      const targetHash = toHash ?? (await this.trackUnlocked(context));
      if (fromHash === targetHash) return null;
      return Promise.all([
        this.resolveTreeish(git, context, fromHash),
        this.resolveTreeish(git, context, targetHash),
      ]);
    });
    // Tree IDs are immutable. Statistics do not use the private index and
    // should not delay the next capture or restore in this workspace.
    return trees
      ? this.comparison.compareTrees(git, trees[0], trees[1])
      : { files: [], totalAdditions: 0, totalDeletions: 0 };
  }

  private async compareSnapshotsUnlocked(
    context: SnapshotContext,
    fromHash: string,
    toHash: string,
    filePath?: string,
  ): Promise<SnapshotComparison> {
    const git = simpleGit(context.projectPath).env(context.env);
    const [fromTree, toTree] = await Promise.all([
      this.resolveTreeish(git, context, fromHash),
      this.resolveTreeish(git, context, toHash),
    ]);

    return this.comparison.compareTrees(git, fromTree, toTree, filePath);
  }

  private async resolveTreeish(
    git: ReturnType<typeof simpleGit>,
    context: SnapshotContext,
    hash: string,
  ): Promise<string> {
    const objectType = (await git.raw(['cat-file', '-t', hash])).trim();
    if (objectType === 'tree') {
      // Callers may supply a ref or abbreviated ID. Pin it before releasing
      // the capture lock so later reads never depend on a moving ref.
      return (await git.revparse(['--verify', hash])).trim();
    }
    if (objectType !== 'commit') {
      throw new Error(`Snapshot ${hash} is a ${objectType}, not a tree or commit`);
    }
    return this.projectTree(git, context, hash);
  }

  /** Resolve legacy selectors at the Git boundary before exposing a revision. */
  async resolveRevision(projectPath: string, selector: string): Promise<string> {
    const context = await this.getContext(projectPath);
    if (!context) throw new Error('Cannot resolve a revision outside a Git repository');
    return this.mutex.run(context.lockKey, () =>
      this.resolveTreeish(simpleGit(context.projectPath).env(context.env), context, selector),
    );
  }

  private async projectTree(
    git: ReturnType<typeof simpleGit>,
    context: SnapshotContext,
    hash: string,
  ): Promise<string> {
    if (!context.projectPrefix) return (await git.raw(['rev-parse', `${hash}^{tree}`])).trim();
    const exists = await git.raw([
      '--literal-pathspecs',
      'ls-tree',
      '-d',
      '-z',
      hash,
      '--',
      context.projectPrefix,
    ]);
    if (exists) return (await git.raw(['rev-parse', `${hash}:${context.projectPrefix}`])).trim();
    return this.emptyTree(git);
  }

  private async emptyTree(git: ReturnType<typeof simpleGit>): Promise<string> {
    await git.raw(['read-tree', '--empty']);
    return (await git.raw(['write-tree'])).trim();
  }

  async getTurnChanges(
    projectPath: string,
    fromHash: string,
    toHash?: string,
  ): Promise<SnapshotComparison> {
    return this.compareSnapshots(projectPath, fromHash, toHash);
  }

  async getCheckpointDiffFiles(
    projectPath: string,
    fromHash: string,
    toHash: string,
    filePath?: string,
  ): Promise<ReviewFile[]> {
    const context = await this.getContext(projectPath);
    if (!context) return [];
    if (filePath) await resolveWorkspaceFile(context.projectPath, filePath);
    const git = simpleGit(context.projectPath).env(context.env);
    const [fromTree, toTree] = await this.mutex.run(context.lockKey, () =>
      Promise.all([
        this.resolveTreeish(git, context, fromHash),
        this.resolveTreeish(git, context, toHash),
      ]),
    );
    // Once tree IDs are resolved, details only read immutable objects and do
    // not need to hold the capture/restore lock while formatting the patch.
    const comparison = await this.comparison.compareTrees(git, fromTree, toTree, filePath);
    const files: ReviewFile[] = comparison.files.map((change) => ({
      ...change,
      state:
        change.status === 'added'
          ? 'untracked'
          : change.status === 'deleted'
            ? 'deleted'
            : 'modified',
      diff: '',
    }));
    if (filePath && files.length === 0)
      files.push({ path: filePath, state: 'modified', diff: '', additions: 0, deletions: 0 });
    await this.comparison.fillDiffs(git, fromTree, toTree, files);
    return files;
  }

  async revertFiles(
    projectPath: string,
    snapshotHash: string,
    patches: FilePatch[],
  ): Promise<void> {
    await this.restoreFiles(projectPath, snapshotHash, patches);
  }

  async restoreFiles(
    projectPath: string,
    snapshotHash: string,
    requestedPatches?: FilePatch[],
  ): Promise<RestoreResult> {
    const context = await this.getContext(projectPath);
    if (!context) {
      throw new Error('Cannot restore files outside a Git repository');
    }
    return this.mutex.run(context.lockKey, async () => {
      const backupHash = await this.trackUnlocked(context);
      const snapshotTree = await this.resolveTreeish(
        simpleGit(context.projectPath).env(context.env),
        context,
        snapshotHash,
      );
      const comparison = await this.compareSnapshotsUnlocked(context, snapshotTree, backupHash);
      const requestedPaths = requestedPatches
        ? new Set(requestedPatches.map((patch) => patch.path))
        : null;
      const patches = comparison.files
        .filter((patch) => !requestedPaths || requestedPaths.has(patch.path))
        .map(({ path: filePath, status, additions, deletions }) => ({
          path: filePath,
          status,
          additions,
          deletions,
        }));

      await this.validateRestore(context, snapshotTree, backupHash, patches);
      try {
        await this.applySnapshot(context, snapshotTree, patches);
      } catch (error) {
        let rollbackError: unknown;
        try {
          await this.rollbackRestore(context, backupHash, patches);
        } catch (failure) {
          rollbackError = failure;
        }
        throw new SnapshotRestoreError(backupHash, error, rollbackError);
      }

      return { backupHash, restoredFiles: patches };
    });
  }

  private async validateRestore(
    context: SnapshotContext,
    snapshotTree: string,
    backupTree: string,
    patches: FilePatch[],
  ): Promise<void> {
    const git = simpleGit(context.projectPath).env(context.env);
    const paths = patches.map((patch) => patch.path);
    const trees = await Promise.all([
      this.comparison.treeEntries(git, snapshotTree, paths),
      this.comparison.treeEntries(git, backupTree, paths),
    ]);
    // Validate the entire operation before touching any file. A gitlink only
    // stores a commit ID and cannot back up the nested repository's contents.
    for (const filePath of paths) {
      const destination = await resolveWorkspaceFile(context.projectPath, filePath);
      if (trees.some((tree) => tree.get(filePath)?.mode === '160000')) {
        throw new Error(
          `Cannot restore nested repository ${filePath}: its contents are not stored in the snapshot`,
        );
      }
      const stat = await fs.lstat(destination).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return null;
        throw error;
      });
      if (stat?.isDirectory())
        throw new Error(`Cannot restore ${filePath}: a directory occupies the file path`);
    }
  }

  private async applySnapshot(
    context: SnapshotContext,
    snapshotHash: string,
    patches: FilePatch[],
  ): Promise<void> {
    const git = simpleGit(context.projectPath).env(context.env);
    const filesToCheckout: string[] = [];
    for (const patch of patches) {
      if (patch.status === 'added') {
        await fs.rm(await resolveWorkspaceFile(context.projectPath, patch.path), {
          force: true,
        });
      } else {
        filesToCheckout.push(patch.path);
      }
    }

    if (filesToCheckout.length > 0) {
      for (const filePath of filesToCheckout)
        await resolveWorkspaceFile(context.projectPath, filePath);
      await git.raw(['--literal-pathspecs', 'checkout', snapshotHash, '--', ...filesToCheckout]);
    }
  }

  private async rollbackRestore(
    context: SnapshotContext,
    backupHash: string,
    originalPatches: FilePatch[],
  ): Promise<void> {
    const git = simpleGit(context.projectPath).env(context.env);
    const filesToCheckout: string[] = [];
    for (const patch of originalPatches) {
      if (patch.status === 'deleted') {
        await fs.rm(await resolveWorkspaceFile(context.projectPath, patch.path), {
          force: true,
        });
      } else {
        filesToCheckout.push(patch.path);
      }
    }
    if (filesToCheckout.length > 0) {
      for (const filePath of filesToCheckout)
        await resolveWorkspaceFile(context.projectPath, filePath);
      await git.raw(['--literal-pathspecs', 'checkout', backupHash, '--', ...filesToCheckout]);
    }
  }

  async getReviewFiles(
    projectPath: string,
    initialHash: string,
    options: ReviewOptions = {},
  ): Promise<ReviewFile[]> {
    return (await this.getReview(projectPath, initialHash, options)).files;
  }

  async getReview(
    projectPath: string,
    initialHash: string,
    options: ReviewOptions = {},
  ): Promise<SnapshotReview> {
    const context = await this.getContext(projectPath);
    if (!context) return { files: [] };
    const git = simpleGit(context.projectPath).env(context.env);
    const { currentTree, workingTree, sessionTree, statusOutput } = await this.mutex.run(
      context.lockKey,
      async () => {
        const currentTree = await this.trackUnlocked(context, false);
        const userGit = simpleGit(context.projectPath);
        const hasHead = await userGit
          .revparse(['--verify', 'HEAD'])
          .then(() => true)
          .catch(() => false);
        const workingTree = hasHead
          ? await this.resolveTreeish(git, context, 'HEAD')
          : await this.emptyTree(git);
        const sessionTree =
          initialHash === 'none'
            ? workingTree
            : await this.resolveTreeish(git, context, initialHash);
        const statusOutput = await userGit.raw([
          'status',
          '--porcelain=v1',
          '-z',
          '--untracked-files=all',
        ]);
        return { currentTree, workingTree, sessionTree, statusOutput };
      },
    );
    // Capture mutable state together, then release the private-index lock.
    // Everything below derives from that capture, even if another turn edits
    // files, stages changes, or commits while this response is being built.
    const [sessionChanges, workingChanges] = await Promise.all([
      this.comparison.compareTrees(git, sessionTree, currentTree),
      sessionTree === workingTree
        ? Promise.resolve(null)
        : this.comparison.compareTrees(git, workingTree, currentTree),
    ]);
    const working = new Map(
      (workingChanges ?? sessionChanges).files.map((file) => [file.path, file]),
    );
    const session = new Map(sessionChanges.files.map((file) => [file.path, file]));
    const entries = new Map<string, ReviewFile>();
    for (const change of sessionChanges.files)
      entries.set(change.path, {
        path: change.path,
        state: 'committed',
        diff: '',
        hasStagedChanges: false,
        hasUnstagedChanges: false,
      });
    const prefix = context.projectPrefix ? `${context.projectPrefix}/` : '';
    for (const file of parseFileStatus(statusOutput)) {
      if (prefix && !file.path.startsWith(prefix)) continue;
      const filePath = file.path.slice(prefix.length);
      if (!filePath) continue;
      const staged = file.index !== ' ' && file.index !== '?';
      const unstaged = file.working_dir !== ' ';
      entries.set(filePath, {
        path: filePath,
        diff: '',
        hasStagedChanges: staged,
        hasUnstagedChanges: unstaged,
        state: file.conflicted
          ? 'conflicted'
          : file.index === '?'
            ? 'untracked'
            : unstaged
              ? file.working_dir === 'D'
                ? 'deleted'
                : 'modified'
              : 'staged',
      });
    }
    const files = [...entries.values()].filter(
      (file) => !options.filePath || file.path === options.filePath,
    );
    for (const file of files) {
      const stats = (options.scope === 'working' ? working : session).get(file.path);
      file.additions = stats?.additions ?? 0;
      file.deletions = stats?.deletions ?? 0;
      file.sessionAdditions = session.get(file.path)?.additions ?? 0;
      file.sessionDeletions = session.get(file.path)?.deletions ?? 0;
    }
    if (options.includeDiffs !== false) {
      await this.comparison.fillDiffs(
        git,
        options.scope === 'working' ? workingTree : sessionTree,
        currentTree,
        files,
      );
    }
    return { files, capture: { currentTree, workingTree, sessionTree } };
  }

  async deleteProjectSnapshots(projectPath: string): Promise<void> {
    const context = await this.getContext(projectPath).catch(() => null);
    if (!context) {
      return;
    }
    return this.mutex.run(context.lockKey, async () => {
      const git = simpleGit(context.projectPath).env(context.env);
      await git.raw(['update-ref', '-d', context.anchorRef]).catch(() => undefined);
      const hash = this.projectHash(context.projectPath);
      const snapshotProjectDir = path.join(this.baseDir, hash);
      await fs.rm(snapshotProjectDir, { recursive: true, force: true }).catch(() => undefined);
    });
  }

  cleanup(): void {
    // No-op, no shadow repos to track
  }
}
