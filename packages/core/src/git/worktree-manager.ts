import type { GitMutex } from './mutex.js';
import { simpleGit } from 'simple-git';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import { type ReviewFile, parseMultiFileDiff } from './utils.js';

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

export interface Workspace {
  readonly path: string;
  readonly branch: string;
  readonly baseCommit: string;

  getDiff(): Promise<string>;
  getReviewFiles(): Promise<ReviewFile[]>;
  stageFile(filePath: string): Promise<void>;
  revertFile(filePath: string): Promise<void>;
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
    const branchSummary = await git.branchLocal();
    const currentBranch = branchSummary.current || 'HEAD';

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
    const branchSummary = await simpleGit(repoPath).branchLocal();
    return branchSummary.current || 'HEAD';
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

    const worktrees = await this.listWorktrees(repoPath);
    const worktreeExists = worktrees.some((w) => w.path === storagePath);

    if (worktreeExists) {
      // Reusing slot!
      const wtGit = simpleGit(storagePath);
      const currentBranch = (await wtGit.raw(['rev-parse', '--abbrev-ref', 'HEAD'])).trim();
      const currentHead = (await wtGit.raw(['rev-parse', 'HEAD'])).trim();

      if (currentHead && currentBranch.startsWith('agentctl/')) {
        await wtGit
          .raw(['update-ref', 'refs/agentctl/pre-refresh', currentHead])
          .catch(() => undefined);
      }

      // Force clean it
      await wtGit.raw(['reset', '--hard']).catch(() => undefined);
      await wtGit.raw(['clean', '-ffdx']).catch(() => undefined);
      // Checkout and reset to target ref
      await wtGit.raw(['checkout', '-B', branchName, baseRef]);

      // Delete the old branch if it was an agentctl branch and is not the current branch
      if (currentBranch !== branchName && currentBranch.startsWith('agentctl/')) {
        await git.raw(['branch', '-D', currentBranch]).catch(() => undefined);
      }
    } else {
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
    activeSessionIds: string[] = [],
  ): Promise<WorktreeResult> {
    const projectName = this.sanitize(path.basename(repoPath));
    const cleanSessionId = this.sanitize(sessionId);
    const cleanTaskSlug = this.sanitize(taskSlug).slice(0, 30);
    const branchName = `agentctl/${cleanSessionId}/${cleanTaskSlug}`;

    const list = await this.listWorktrees(repoPath).catch(() => []);
    const activeCleanIds = new Set(activeSessionIds.map((id) => this.sanitize(id)));

    let storagePath = '';
    for (let slotIndex = 0; slotIndex < 1000; slotIndex++) {
      const candidatePath = path.join(this.baseDir, projectName, `slot-${slotIndex.toString()}`);
      const matchingWorktree = list.find((w) => w.path === candidatePath);
      let isSlotActive = false;
      if (matchingWorktree) {
        const parts = matchingWorktree.branch.split('/');
        if (parts.length >= 2 && parts[0] === 'agentctl') {
          const slotSessionId = parts[1];
          if (activeCleanIds.has(slotSessionId)) {
            isSlotActive = true;
          }
        }
      }
      if (!isSlotActive) {
        storagePath = candidatePath;
        break;
      }
    }

    await fs.mkdir(path.dirname(storagePath), { recursive: true });

    return await this.gitMutex.run(repoPath, async () => {
      const base = await this.resolveBaseRef(repoPath, baseBranch);
      if (base.isEmpty) {
        throw new Error('Cannot create worktree in an empty repository (no commits found)');
      }

      await this.addWorktree(repoPath, branchName, storagePath, base.ref);

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

  async addBranchWorktree(
    repoPath: string,
    sessionId: string,
    branchName: string,
    workdirPrefix = '',
  ): Promise<{ path: string; workspacePath: string }> {
    const projectName = this.sanitize(path.basename(repoPath));
    const cleanSessionId = this.sanitize(sessionId);
    const storagePath = path.join(this.baseDir, projectName, `checkout-${cleanSessionId}`);

    await fs.mkdir(path.dirname(storagePath), { recursive: true });

    return await this.gitMutex.run(repoPath, async () => {
      // Remove existing worktree at this path if any
      const worktrees = await this.listWorktrees(repoPath);
      const worktreeExists = worktrees.some((w) => w.path === storagePath);
      if (worktreeExists) {
        await this.removeWorktree(repoPath, storagePath);
      }
      await fs.rm(storagePath, { recursive: true, force: true }).catch(() => undefined);

      // Use --force so the worktree can be created even if the branch is
      // currently active in the main project directory. Git allows this —
      // commits from either location go to the same branch.
      await simpleGit(repoPath).raw(['worktree', 'add', '--force', storagePath, branchName]);

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

  async sync(repoPath: string, activeSessionIds: string[]): Promise<void> {
    const orphans = await this.listOrphans(repoPath, activeSessionIds);
    for (const orphan of orphans) {
      await this.cleanup(repoPath, orphan.path, orphan.branch);
    }
  }

  async getDiff(repoPath: string, worktreePath: string, baseCommit: string): Promise<string> {
    if (baseCommit === 'none') {
      return '';
    }
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
    if (baseCommit === 'none') {
      return [];
    }
    return await this.gitMutex.run(repoPath, async () => {
      const git = simpleGit(worktreePath);
      const status = await git.status();
      const files = new Map<string, ReviewFile>();

      const [stagedDiffsRaw, unstagedDiffsRaw, committedDiffsRaw] = await Promise.all([
        git.diff(['--cached']).catch(() => ''),
        git.diff([]).catch(() => ''),
        git.diff([`${baseCommit}...HEAD`]).catch(() => ''),
      ]);

      const stagedDiffs = parseMultiFileDiff(stagedDiffsRaw);
      const unstagedDiffs = parseMultiFileDiff(unstagedDiffsRaw);
      const committedDiffs = parseMultiFileDiff(committedDiffsRaw);
      const conflictedSet = new Set(status.conflicted);

      for (const file of status.files) {
        if (conflictedSet.has(file.path)) {
          files.set(file.path, {
            path: file.path,
            state: 'conflicted',
            diff:
              unstagedDiffs.get(file.path) ??
              stagedDiffs.get(file.path) ??
              `diff --git a/${file.path} b/${file.path}`,
          });
          continue;
        }

        if (file.index === '?') {
          const fullPath = path.join(worktreePath, file.path);
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

          files.set(file.path, {
            path: file.path,
            state: 'untracked',
            diff,
          });
          continue;
        }

        if (file.index !== ' ' && file.index !== '?') {
          files.set(file.path, {
            path: file.path,
            state: 'staged',
            diff: stagedDiffs.get(file.path) ?? `diff --git a/${file.path} b/${file.path}`,
          });
          continue;
        }

        if (file.working_dir === 'D') {
          files.set(file.path, {
            path: file.path,
            state: 'deleted',
            diff: unstagedDiffs.get(file.path) ?? `diff --git a/${file.path} b/${file.path}`,
          });
          continue;
        }

        if (file.working_dir === 'M') {
          files.set(file.path, {
            path: file.path,
            state: 'modified',
            diff: unstagedDiffs.get(file.path) ?? `diff --git a/${file.path} b/${file.path}`,
          });
        }
      }

      const committedFiles = await git
        .raw(['diff', '--name-only', `${baseCommit}...HEAD`])
        .catch(() => '');
      for (const filePath of committedFiles.split('\n').filter(Boolean)) {
        if (files.has(filePath)) continue;

        files.set(filePath, {
          path: filePath,
          state: 'committed',
          diff: committedDiffs.get(filePath) ?? `diff --git a/${filePath} b/${filePath}`,
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
        const gitWorktree = simpleGit(worktreePath);

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
        } catch (err: unknown) {
          // Revert host merge state
          await simpleGit(repoPath)
            .merge(['--abort'])
            .catch(() => undefined);
          if (originalBranch && originalBranch !== baseBranch) {
            await simpleGit(repoPath)
              .checkout(originalBranch)
              .catch(() => undefined);
          }
          throw err;
        }

        // Restore original branch
        if (originalBranch && originalBranch !== baseBranch) {
          await simpleGit(repoPath).checkout(originalBranch);
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

  async stageAll(repoPath: string, worktreePath: string): Promise<void> {
    await this.gitMutex.run(repoPath, async () => {
      await simpleGit(worktreePath).raw(['add', '.']);
    });
  }

  async unstageFile(repoPath: string, worktreePath: string, filePath: string): Promise<void> {
    await this.gitMutex.run(repoPath, async () => {
      await simpleGit(worktreePath).raw(['reset', 'HEAD', filePath]);
    });
  }

  async unstageAll(repoPath: string, worktreePath: string): Promise<void> {
    await this.gitMutex.run(repoPath, async () => {
      await simpleGit(worktreePath).raw(['reset', 'HEAD']);
    });
  }

  async commit(repoPath: string, worktreePath: string, message: string): Promise<void> {
    await this.gitMutex.run(repoPath, async () => {
      await simpleGit(worktreePath).commit(message);
    });
  }

  async push(
    repoPath: string,
    worktreePath: string,
  ): Promise<{ success: boolean; output: string }> {
    return await this.gitMutex.run(repoPath, async () => {
      try {
        const git = simpleGit(worktreePath);
        const remotes = await git.getRemotes();
        if (remotes.length === 0) {
          throw new Error('No git remotes configured for this repository');
        }
        const branchSummary = await git.branchLocal();
        const currentBranch = branchSummary.current;
        const result = await git.push(['-u', remotes[0].name, currentBranch]);
        return { success: true, output: JSON.stringify(result) };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        throw new Error(`Git push failed: ${message}`);
      }
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
    return await this.gitMutex.run(repoPath, async () => {
      try {
        const git = simpleGit(worktreePath);
        const remotes = await git.getRemotes();
        if (remotes.length === 0) {
          throw new Error('No git remotes configured for this repository');
        }

        const branchSummary = await git.branchLocal();
        const currentBranch = branchSummary.current;
        if (!currentBranch || currentBranch === 'HEAD') {
          throw new Error('Cannot pull from detached HEAD');
        }

        const status = await git.status();
        if (!status.isClean()) {
          throw new Error('Cannot pull: worktree has uncommitted changes');
        }

        const beforeCommit = (await git.revparse(['HEAD'])).trim();
        const remoteName = remotes[0].name;

        // Fetch remote updates
        await git.fetch(remoteName, currentBranch).catch(async () => {
          await git.fetch();
        });

        const remoteTrackingRef = `${remoteName}/${currentBranch}`;
        let targetCommit: string | null = null;
        try {
          targetCommit = (await git.revparse([remoteTrackingRef])).trim();
        } catch {
          // Tracking ref might not be directly resolveable
        }

        if (targetCommit) {
          if (beforeCommit === targetCommit) {
            return { success: true, output: 'Already up to date.' };
          }

          const mergeBase = (
            await git.raw(['merge-base', beforeCommit, targetCommit]).catch(() => '')
          ).trim();
          const isAncestor = mergeBase.length > 0 && mergeBase === beforeCommit;

          if (isAncestor) {
            await git.raw(['merge', '--ff-only', targetCommit]);
          } else {
            // Upstream was rewritten (rebase, squash, or amend)
            // Preserve the pre-refresh commit under refs/agentctl/pre-refresh
            await git.raw(['update-ref', 'refs/agentctl/pre-refresh', beforeCommit]);
            // Lossless merge reset
            await git.raw(['reset', '--merge', targetCommit]);
          }
        } else {
          // Fallback to ff-only pull
          const pullResult = await git.pull(['--ff-only']);
          return { success: true, output: JSON.stringify(pullResult) };
        }

        const afterCommit = (await git.revparse(['HEAD'])).trim();
        return {
          success: true,
          output: `Successfully updated from ${beforeCommit.slice(0, 7)} to ${afterCommit.slice(0, 7)}`,
        };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        throw new Error(`Git pull failed: ${message}`);
      }
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
