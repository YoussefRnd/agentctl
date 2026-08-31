import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { simpleGit } from 'simple-git';
import { type ReviewFile, parseMultiFileDiff } from './utils.js';

export interface FilePatch {
  path: string;
  status: 'added' | 'modified' | 'deleted';
}

export class SnapshotService {
  private baseDir: string;

  constructor(baseDir?: string) {
    this.baseDir = baseDir ?? path.join(os.homedir(), '.local', 'share', 'agentctl', 'snapshots');
  }

  private projectHash(projectPath: string): string {
    return crypto.createHash('sha256').update(projectPath).digest('hex').substring(0, 16);
  }

  private async getEnv(projectPath: string): Promise<Record<string, string> | null> {
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

    const gitDir = (await userGit.revparse(['--git-dir'])).trim();
    const absoluteGitDir = path.isAbsolute(gitDir) ? gitDir : path.resolve(projectPath, gitDir);
    const hash = this.projectHash(projectPath);
    const indexFile = path.join(this.baseDir, hash, 'index');
    await fs.mkdir(path.dirname(indexFile), { recursive: true });

    return {
      GIT_DIR: absoluteGitDir,
      GIT_WORK_TREE: projectPath,
      GIT_INDEX_FILE: indexFile,
    };
  }

  async track(projectPath: string): Promise<string | undefined> {
    const env = await this.getEnv(projectPath);
    if (!env) {
      return undefined;
    }

    const git = simpleGit(projectPath).env(env);

    try {
      const hasCommits = await git
        .revparse(['HEAD'])
        .then(() => true)
        .catch(() => false);
      if (hasCommits) {
        const hostGit = simpleGit(projectPath);
        const status = await hostGit.status().catch(() => null);
        if (status?.files.length === 0) {
          const headTree = (await git.raw(['rev-parse', 'HEAD^{tree}'])).trim();
          if (headTree.length > 0) {
            return headTree;
          }
        }
        await git.raw(['read-tree', 'HEAD']).catch(() => undefined);
      }

      await git.raw(['add', '-A']).catch(() => undefined);
      const treeHash = (await git.raw(['write-tree'])).trim();
      return treeHash.length > 0 ? treeHash : undefined;
    } catch {
      return undefined;
    }
  }

  async diff(projectPath: string, fromHash: string): Promise<FilePatch[]> {
    const currentHash = await this.track(projectPath);
    if (!currentHash) {
      return [];
    }

    const env = await this.getEnv(projectPath);
    if (!env) {
      return [];
    }

    const git = simpleGit(projectPath).env(env);

    const diffOutput = await git.raw(['diff-tree', '-r', '--no-commit-id', fromHash, currentHash]);

    const patches: FilePatch[] = [];
    for (const line of diffOutput.trim().split('\n')) {
      if (!line) continue;
      const parts = line.split(/\t/);
      if (parts.length < 2) continue;
      const statusChar = parts[0].split(/\s+/).pop();
      const filePath = parts[1];
      let status: FilePatch['status'] = 'modified';
      if (statusChar === 'A') status = 'added';
      else if (statusChar === 'D') status = 'deleted';
      patches.push({ path: filePath, status });
    }

    return patches;
  }

  async diffBetween(projectPath: string, fromHash: string, toHash: string): Promise<FilePatch[]> {
    const env = await this.getEnv(projectPath);
    if (!env) {
      return [];
    }

    const git = simpleGit(projectPath).env(env);
    const diffOutput = await git
      .raw(['diff-tree', '-r', '--no-commit-id', fromHash, toHash])
      .catch(() => '');

    const patches: FilePatch[] = [];
    for (const line of diffOutput.trim().split('\n')) {
      if (!line) continue;
      const parts = line.split(/\t/);
      if (parts.length < 2) continue;
      const statusChar = parts[0].split(/\s+/).pop();
      const filePath = parts[1];
      let status: FilePatch['status'] = 'modified';
      if (statusChar === 'A') status = 'added';
      else if (statusChar === 'D') status = 'deleted';
      patches.push({ path: filePath, status });
    }

    return patches;
  }

  async getTurnChanges(
    projectPath: string,
    fromHash: string,
    toHash?: string,
  ): Promise<{
    files: Array<{
      path: string;
      additions: number;
      deletions: number;
      status: 'added' | 'modified' | 'deleted';
    }>;
    totalAdditions: number;
    totalDeletions: number;
  }> {
    const targetHash = toHash ?? (await this.track(projectPath));
    if (!fromHash || !targetHash || fromHash === targetHash) {
      return { files: [], totalAdditions: 0, totalDeletions: 0 };
    }

    const env = await this.getEnv(projectPath);
    if (!env) {
      return { files: [], totalAdditions: 0, totalDeletions: 0 };
    }

    const git = simpleGit(projectPath).env(env);

    const [statusOutput, numstatOutput] = await Promise.all([
      git.raw(['diff-tree', '-r', '--no-commit-id', fromHash, targetHash]).catch(() => ''),
      git
        .raw(['diff-tree', '--numstat', '-r', '--no-commit-id', fromHash, targetHash])
        .catch(() => ''),
    ]);

    const statusMap = new Map<string, 'added' | 'modified' | 'deleted'>();
    for (const line of statusOutput.trim().split('\n')) {
      if (!line) continue;
      const parts = line.split(/\t/);
      if (parts.length < 2) continue;
      const statusChar = parts[0].split(/\s+/).pop();
      const filePath = parts[1];
      let status: 'added' | 'modified' | 'deleted' = 'modified';
      if (statusChar === 'A') status = 'added';
      else if (statusChar === 'D') status = 'deleted';
      statusMap.set(filePath, status);
    }

    const files: Array<{
      path: string;
      additions: number;
      deletions: number;
      status: 'added' | 'modified' | 'deleted';
    }> = [];
    let totalAdditions = 0;
    let totalDeletions = 0;

    for (const line of numstatOutput.trim().split('\n')) {
      if (!line) continue;
      const parts = line.split(/\t/);
      if (parts.length < 3) continue;
      const adds = parts[0] === '-' ? 0 : parseInt(parts[0], 10) || 0;
      const dels = parts[1] === '-' ? 0 : parseInt(parts[1], 10) || 0;
      const filePath = parts[2];
      const status = statusMap.get(filePath) ?? 'modified';

      files.push({
        path: filePath,
        additions: adds,
        deletions: dels,
        status,
      });
      totalAdditions += adds;
      totalDeletions += dels;
    }

    return {
      files,
      totalAdditions,
      totalDeletions,
    };
  }

  async getCheckpointDiffFiles(
    projectPath: string,
    fromHash: string,
    toHash: string,
  ): Promise<ReviewFile[]> {
    const env = await this.getEnv(projectPath);
    if (!env) {
      return [];
    }

    const git = simpleGit(projectPath).env(env);
    const patches = await this.diffBetween(projectPath, fromHash, toHash);
    if (patches.length === 0) {
      return [];
    }

    const reviewFiles: ReviewFile[] = [];
    for (const patch of patches) {
      const fileDiff = await git.diff([fromHash, toHash, '--', patch.path]).catch(() => '');
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
    const env = await this.getEnv(projectPath);
    if (!env) {
      return;
    }

    const filesToCheckout: string[] = [];
    for (const patch of patches) {
      if (patch.status === 'added') {
        const fullPath = path.join(projectPath, patch.path);
        await fs.rm(fullPath, { recursive: true, force: true }).catch(() => undefined);
      } else {
        filesToCheckout.push(patch.path);
      }
    }

    if (filesToCheckout.length > 0) {
      const git = simpleGit(projectPath).env(env);
      await git.raw(['checkout', snapshotHash, '--', ...filesToCheckout]).catch(() => undefined);
    }
  }

  async getReviewFiles(projectPath: string, initialHash: string): Promise<ReviewFile[]> {
    if (initialHash === 'none') {
      return [];
    }

    const patches = await this.diff(projectPath, initialHash);
    if (patches.length === 0) {
      return [];
    }

    const env = await this.getEnv(projectPath);
    if (!env) {
      return [];
    }

    const git = simpleGit(projectPath).env(env);
    const status = await simpleGit(projectPath).status();
    const reviewFiles: ReviewFile[] = [];

    const changedPaths = new Set(patches.map((p) => p.path));

    const userGit = simpleGit(projectPath);
    const [stagedDiffsRaw, unstagedDiffsRaw] = await Promise.all([
      userGit.diff(['--cached']).catch(() => ''),
      userGit.diff([]).catch(() => ''),
    ]);

    const stagedDiffs = parseMultiFileDiff(stagedDiffsRaw);
    const unstagedDiffs = parseMultiFileDiff(unstagedDiffsRaw);
    const conflictedSet = new Set(status.conflicted);

    for (const file of status.files) {
      if (!changedPaths.has(file.path)) {
        continue;
      }

      if (conflictedSet.has(file.path)) {
        reviewFiles.push({
          path: file.path,
          state: 'conflicted',
          diff:
            unstagedDiffs.get(file.path) ??
            stagedDiffs.get(file.path) ??
            `diff --git a/${file.path} b/${file.path}`,
        });
        changedPaths.delete(file.path);
        continue;
      }

      if (file.index === '?') {
        const fullPath = path.join(projectPath, file.path);
        let content = '';
        try {
          content = await fs.readFile(fullPath, 'utf8');
        } catch {
          // ignore
        }
        const lines = content.split('\n');
        const header = [
          `diff --git a/${file.path} b/${file.path}`,
          `new file mode 100644`,
          `--- /dev/null`,
          `+++ b/${file.path}`,
          `@@ -0,0 +1,${String(lines.length)} @@`,
        ];
        const diffLines = lines.map((line) => `+${line}`);
        const diff = [...header, ...diffLines].join('\n');

        reviewFiles.push({
          path: file.path,
          state: 'untracked',
          diff,
        });
        changedPaths.delete(file.path);
        continue;
      }

      if (file.index !== ' ' && file.index !== '?') {
        reviewFiles.push({
          path: file.path,
          state: 'staged',
          diff: stagedDiffs.get(file.path) ?? `diff --git a/${file.path} b/${file.path}`,
        });
        changedPaths.delete(file.path);
        continue;
      }

      if (file.working_dir === 'D') {
        reviewFiles.push({
          path: file.path,
          state: 'deleted',
          diff: unstagedDiffs.get(file.path) ?? `diff --git a/${file.path} b/${file.path}`,
        });
        changedPaths.delete(file.path);
        continue;
      }

      if (file.working_dir === 'M') {
        reviewFiles.push({
          path: file.path,
          state: 'modified',
          diff: unstagedDiffs.get(file.path) ?? `diff --git a/${file.path} b/${file.path}`,
        });
        changedPaths.delete(file.path);
      }
    }

    for (const filePath of changedPaths) {
      const fileDiff = await git.diff([initialHash, '--', filePath]).catch(() => '');
      reviewFiles.push({
        path: filePath,
        state: 'committed',
        diff: fileDiff || `diff --git a/${filePath} b/${filePath}`,
      });
    }

    return reviewFiles;
  }

  cleanup(): void {
    // No-op, no shadow repos to track
  }
}
