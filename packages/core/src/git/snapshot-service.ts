import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { simpleGit } from 'simple-git';
import { type ReviewFile, parseMultiFileDiff } from './git-utils.js';

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
