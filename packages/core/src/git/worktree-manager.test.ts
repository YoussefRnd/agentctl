import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { WorktreeManager } from './worktree-manager.js';
import { GitMutex } from '../utils/git-mutex.js';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import { simpleGit } from 'simple-git';
import type { SimpleGit } from 'simple-git';

describe('WorktreeManager - Integration', () => {
  let worktreeManager: WorktreeManager;
  let gitMutex: GitMutex;
  let repoPath: string;
  let git: SimpleGit;
  let testBaseDir: string;

  beforeEach(async () => {
    gitMutex = new GitMutex();
    testBaseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agentctl-worktrees-'));
    worktreeManager = new WorktreeManager(gitMutex);
    worktreeManager.setBaseDir(testBaseDir);

    repoPath = await fs.mkdtemp(path.join(os.tmpdir(), 'agentctl-test-repo-'));
    git = simpleGit(repoPath);
    await git.init();
    await git.checkoutLocalBranch('main');
    await fs.writeFile(path.join(repoPath, 'README.md'), '# Test Repo');
    await git.add('.');
    await git.commit('Initial commit');
  });

  afterEach(async () => {
    try {
      const gitInstance = simpleGit(repoPath);
      const list = await gitInstance.raw(['worktree', 'list', '--porcelain']);
      const worktreePaths = list
        .split('\n')
        .filter((l) => l.startsWith('worktree '))
        .map((l) => l.substring(9).trim())
        .filter((p) => p !== repoPath);

      for (const p of worktreePaths) {
        await gitInstance.raw(['worktree', 'remove', '--force', p]).catch(() => { /* ignore */ });
      }
    } catch { /* ignore */ }

    await fs.rm(repoPath, { recursive: true, force: true }).catch(() => { /* ignore */ });
    await fs.rm(testBaseDir, { recursive: true, force: true }).catch(() => { /* ignore */ });
  });

  it('should handle the full lifecycle of a successful agent session', async () => {
    // 1. Create
    const sessionId = 'lifecycle-session';
    const taskSlug = 'feat-full-cycle';
    const result = await worktreeManager.create(repoPath, sessionId, taskSlug);

    const stats = await fs.stat(result.path);
    expect(stats.isDirectory()).toBe(true);

    // 2. Work in isolation
    const filePath = path.join(result.path, 'feature.ts');
    await fs.writeFile(filePath, 'console.log("hello");');
    const wtGit = simpleGit(result.path);
    await wtGit.add('.');
    await wtGit.commit('Implement feature');

    // 3. Diff review
    const diff = await worktreeManager.getDiff(repoPath, result.path, result.baseCommit);
    expect(diff).toContain('feature.ts');
    expect(diff).toContain('+console.log("hello");');

    // 4. Merge back to base
    await worktreeManager.finalize(repoPath, result.path, result.branch, 'main', 'merge', taskSlug);

    // 5. Verify cleanup and integration
    await expect(fs.stat(result.path)).rejects.toThrow(); // Worktree removed
    const branches = await git.branch();
    expect(branches.all).not.toContain(result.branch); // Branch removed
    
    await git.checkout('main');
    const log = await git.log();
    expect(log.latest?.message).toBe(taskSlug); // Squashed commit present
    const content = await fs.readFile(path.join(repoPath, 'feature.ts'), 'utf8');
    expect(content).toBe('console.log("hello");'); // File is integrated
  });

  it('should isolate parallel operations and handle discard', async () => {
    // Create parallel sessions
    const [res1, res2] = await Promise.all([
      worktreeManager.create(repoPath, 'session-1', 'task-1'),
      worktreeManager.create(repoPath, 'session-2', 'task-2'),
    ]);

    // Work in res1
    await fs.writeFile(path.join(res1.path, '1.txt'), 'one');
    await simpleGit(res1.path).add('.').commit('one');

    // Discard res1
    await worktreeManager.finalize(repoPath, res1.path, res1.branch, 'main', 'discard', 'task-1');

    // Verify isolation and cleanup
    await expect(fs.stat(res1.path)).rejects.toThrow();
    const stats2 = await fs.stat(res2.path);
    expect(stats2.isDirectory()).toBe(true); // res2 still alive

    await git.checkout('main');
    await expect(fs.stat(path.join(repoPath, '1.txt'))).rejects.toThrow(); // Changes never merged
  });

  it('should sync and clean up orphaned environments', async () => {
    // Create 3 sessions, but only 1 is active in DB
    const res1 = await worktreeManager.create(repoPath, 'orphan-1', 'task');
    const res2 = await worktreeManager.create(repoPath, 'orphan-2', 'task');
    const resActive = await worktreeManager.create(repoPath, 'active-1', 'task');

    // Run sync
    await worktreeManager.sync(repoPath, ['active-1']);

    // Verify orphans removed, active kept
    await expect(fs.stat(res1.path)).rejects.toThrow();
    await expect(fs.stat(res2.path)).rejects.toThrow();
    const stats = await fs.stat(resActive.path);
    expect(stats.isDirectory()).toBe(true);
  });
});
