import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { simpleGit } from 'simple-git';
import { type ReviewFile } from './utils.js';
import { GitMutex } from './mutex.js';

export interface FilePatch {
  path: string;
  status: 'added' | 'modified' | 'deleted';
}

export interface SnapshotFileChange extends FilePatch {
  additions: number;
  deletions: number;
}

export interface SnapshotComparison {
  files: SnapshotFileChange[];
  totalAdditions: number;
  totalDeletions: number;
}

export interface RestoreResult {
  backupHash: string;
  restoredFiles: FilePatch[];
}

interface SnapshotContext {
  projectPath: string;
  projectPrefix: string;
  env: Record<string, string>;
  lockKey: string;
  anchorRef: string;
}

export class SnapshotService {
  private baseDir: string;
  private readonly mutex = new GitMutex();

  constructor(baseDir?: string) {
    this.baseDir = baseDir ?? path.join(os.homedir(), '.local', 'share', 'agentctl', 'snapshots');
  }

  private projectHash(projectPath: string): string {
    return crypto.createHash('sha256').update(projectPath).digest('hex').substring(0, 16);
  }

  private async getContext(projectPath: string): Promise<SnapshotContext | null> {
    const exists = await fs
      .access(projectPath)
      .then(() => true)
      .catch(() => false);
    if (!exists) {
      return null;
    }

    const userGit = simpleGit(projectPath);
    const isGitRepo = await userGit.checkIsRepo().catch(() => false);
    if (!isGitRepo) {
      return null;
    }

    const canonicalProjectPath = await fs.realpath(projectPath);
    const repositoryRoot = await fs.realpath((await userGit.revparse(['--show-toplevel'])).trim());
    const projectPrefix = path
      .relative(repositoryRoot, canonicalProjectPath)
      .split(path.sep)
      .join('/');
    if (projectPrefix === '..' || projectPrefix.startsWith('../')) {
      throw new Error('Project path resolves outside its Git worktree');
    }
    const gitDir = (await userGit.revparse(['--git-dir'])).trim();
    const absoluteGitDir = path.isAbsolute(gitDir)
      ? await fs.realpath(gitDir)
      : await fs.realpath(path.resolve(projectPath, gitDir));
    const hash = this.projectHash(canonicalProjectPath);
    const indexFile = path.join(this.baseDir, hash, 'index');
    await fs.mkdir(path.dirname(indexFile), { recursive: true });

    return {
      projectPath: canonicalProjectPath,
      projectPrefix,
      lockKey: canonicalProjectPath,
      anchorRef: `refs/agentctl/snapshots/${hash}`,
      env: {
        GIT_DIR: absoluteGitDir,
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

  private async trackUnlocked(context: SnapshotContext): Promise<string> {
    const git = simpleGit(context.projectPath).env(context.env);
    const hasCommits = await git
      .revparse(['--verify', 'HEAD'])
      .then(() => true)
      .catch(() => false);
    if (hasCommits) {
      await git.raw(['read-tree', 'HEAD']);
    } else {
      await git.raw(['read-tree', '--empty']);
    }

    await git.raw(['add', '-A']);
    const treeHash = (await git.raw(['write-tree'])).trim();
    if (!/^[0-9a-f]{40,64}$/i.test(treeHash)) {
      throw new Error('Git returned an invalid snapshot tree hash');
    }

    await this.anchorSnapshot(git, context.anchorRef, treeHash);
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
    const context = await this.getContext(projectPath);
    if (!context) {
      return [];
    }
    return this.mutex.run(context.lockKey, async () => {
      const currentHash = await this.trackUnlocked(context);
      const comparison = await this.compareSnapshotsUnlocked(context, fromHash, currentHash);
      return comparison.files.map(({ path: filePath, status }) => ({ path: filePath, status }));
    });
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
    return this.mutex.run(context.lockKey, async () => {
      const targetHash = toHash ?? (await this.trackUnlocked(context));
      if (fromHash === targetHash) {
        return { files: [], totalAdditions: 0, totalDeletions: 0 };
      }
      return this.compareSnapshotsUnlocked(context, fromHash, targetHash);
    });
  }

  private async compareSnapshotsUnlocked(
    context: SnapshotContext,
    fromHash: string,
    toHash: string,
  ): Promise<SnapshotComparison> {
    const git = simpleGit(context.projectPath).env(context.env);
    const [fromTree, toTree] = await Promise.all([
      this.resolveTreeish(git, context, fromHash),
      this.resolveTreeish(git, context, toHash),
    ]);

    const [statusOutput, numstatOutput] = await Promise.all([
      git.raw([
        'diff-tree',
        '-r',
        '--no-commit-id',
        '--no-renames',
        '--name-status',
        '-z',
        fromTree,
        toTree,
      ]),
      git.raw([
        'diff-tree',
        '-r',
        '--no-commit-id',
        '--no-renames',
        '--numstat',
        '-z',
        fromTree,
        toTree,
      ]),
    ]);

    const statuses = new Map<string, FilePatch['status']>();
    const statusFields = statusOutput.split('\0');
    for (let index = 0; index + 1 < statusFields.length; index += 2) {
      const statusCode = statusFields[index];
      const filePath = statusFields[index + 1];
      if (!statusCode || !filePath) continue;
      statuses.set(
        filePath,
        statusCode === 'A' ? 'added' : statusCode === 'D' ? 'deleted' : 'modified',
      );
    }

    const files: SnapshotFileChange[] = [];
    let totalAdditions = 0;
    let totalDeletions = 0;

    for (const record of numstatOutput.split('\0')) {
      if (!record) continue;
      const firstTab = record.indexOf('\t');
      const secondTab = record.indexOf('\t', firstTab + 1);
      if (firstTab < 0 || secondTab < 0) continue;
      const additionsText = record.slice(0, firstTab);
      const deletionsText = record.slice(firstTab + 1, secondTab);
      const filePath = record.slice(secondTab + 1);
      const additions = additionsText === '-' ? 0 : Number.parseInt(additionsText, 10);
      const deletions = deletionsText === '-' ? 0 : Number.parseInt(deletionsText, 10);
      const change = {
        path: filePath,
        additions: Number.isFinite(additions) ? additions : 0,
        deletions: Number.isFinite(deletions) ? deletions : 0,
        status: statuses.get(filePath) ?? 'modified',
      } satisfies SnapshotFileChange;
      files.push(change);
      totalAdditions += change.additions;
      totalDeletions += change.deletions;
    }

    return { files, totalAdditions, totalDeletions };
  }

  private async resolveTreeish(
    git: ReturnType<typeof simpleGit>,
    context: SnapshotContext,
    hash: string,
  ): Promise<string> {
    const objectType = (await git.raw(['cat-file', '-t', hash])).trim();
    if (objectType === 'tree') {
      return hash;
    }
    if (objectType !== 'commit') {
      throw new Error(`Snapshot ${hash} is a ${objectType}, not a tree or commit`);
    }
    const revision = context.projectPrefix ? `${hash}:${context.projectPrefix}` : `${hash}^{tree}`;
    return (await git.raw(['rev-parse', revision])).trim();
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
  ): Promise<ReviewFile[]> {
    const context = await this.getContext(projectPath);
    if (!context) {
      return [];
    }

    const git = simpleGit(context.projectPath).env(context.env);
    const [fromTree, toTree] = await Promise.all([
      this.resolveTreeish(git, context, fromHash),
      this.resolveTreeish(git, context, toHash),
    ]);
    const patches = await this.diffBetween(projectPath, fromHash, toHash);
    if (patches.length === 0) {
      return [];
    }

    const reviewFiles: ReviewFile[] = [];
    for (const patch of patches) {
      const fileDiff = await git.diff([fromTree, toTree, '--', patch.path]);
      const state =
        patch.status === 'added'
          ? 'untracked'
          : patch.status === 'deleted'
            ? 'deleted'
            : 'modified';

      reviewFiles.push({
        path: patch.path,
        state,
        diff: fileDiff || `diff --git a/${patch.path} b/${patch.path}`,
      });
    }

    return reviewFiles;
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
        .map(({ path: filePath, status }) => ({ path: filePath, status }));

      try {
        await this.applySnapshot(context, snapshotTree, patches);
      } catch (error) {
        await this.rollbackRestore(context, backupHash, patches).catch(() => undefined);
        throw error;
      }

      return { backupHash, restoredFiles: patches };
    });
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
        await fs.rm(this.resolveProjectFile(context.projectPath, patch.path), {
          recursive: true,
          force: true,
        });
      } else {
        filesToCheckout.push(patch.path);
      }
    }

    if (filesToCheckout.length > 0) {
      await git.raw(['checkout', snapshotHash, '--', ...filesToCheckout]);
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
        await fs.rm(this.resolveProjectFile(context.projectPath, patch.path), {
          recursive: true,
          force: true,
        });
      } else {
        filesToCheckout.push(patch.path);
      }
    }
    if (filesToCheckout.length > 0) {
      await git.raw(['checkout', backupHash, '--', ...filesToCheckout]);
    }
  }

  private resolveProjectFile(projectPath: string, filePath: string): string {
    if (path.isAbsolute(filePath)) {
      throw new Error(`Snapshot contains an absolute path: ${filePath}`);
    }
    const resolved = path.resolve(projectPath, filePath);
    if (resolved !== projectPath && !resolved.startsWith(`${projectPath}${path.sep}`)) {
      throw new Error(`Snapshot path escapes the project: ${filePath}`);
    }
    return resolved;
  }

  async getReviewFiles(projectPath: string, initialHash: string): Promise<ReviewFile[]> {
    if (initialHash === 'none') {
      return [];
    }

    const context = await this.getContext(projectPath);
    if (!context) {
      return [];
    }

    return this.mutex.run(context.lockKey, async () => {
      const currentHash = await this.trackUnlocked(context);
      const comparison = await this.compareSnapshotsUnlocked(context, initialHash, currentHash);
      if (comparison.files.length === 0) {
        return [];
      }

      const git = simpleGit(context.projectPath).env(context.env);
      const status = await simpleGit(context.projectPath).status();
      const initialTree = await this.resolveTreeish(git, context, initialHash);
      const reviewFiles: ReviewFile[] = [];
      const conflictedSet = new Set(status.conflicted);
      const statusByPath = new Map(status.files.map((file) => [file.path, file]));

      for (const patch of comparison.files) {
        const file = statusByPath.get(patch.path);
        const state: ReviewFile['state'] = conflictedSet.has(patch.path)
          ? 'conflicted'
          : file?.index === '?'
            ? 'untracked'
            : file && file.index !== ' '
              ? 'staged'
              : file?.working_dir === 'D'
                ? 'deleted'
                : file && file.working_dir !== ' '
                  ? 'modified'
                  : 'committed';
        const fileDiff = await git.diff([initialTree, currentHash, '--', patch.path]);
        reviewFiles.push({
          path: patch.path,
          state,
          diff: fileDiff || `diff --git a/${patch.path} b/${patch.path}`,
        });
      }

      return reviewFiles;
    });
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
