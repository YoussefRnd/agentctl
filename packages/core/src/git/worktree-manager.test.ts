import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { WorktreeManager } from './worktree-manager.js';
import { GitMutex } from '../utils/git-mutex.js';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import { simpleGit, SimpleGit } from 'simple-git';

describe.sequential('WorktreeManager', () => {
  let worktreeManager: WorktreeManager;
  let gitMutex: GitMutex;
  let repoPath: string;
  let git: SimpleGit;
  let testBaseDir: string;

  beforeEach(async () => {
    gitMutex = new GitMutex();

    // Create a unique baseDir for this test run
    testBaseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agentctl-worktrees-'));
    worktreeManager = new WorktreeManager(gitMutex);
    worktreeManager.setBaseDir(testBaseDir);

    // Create a temporary repo
    repoPath = await fs.mkdtemp(path.join(os.tmpdir(), 'agentctl-test-repo-'));
    git = simpleGit(repoPath);
    await git.init();
    await git.checkoutLocalBranch('main');
    await fs.writeFile(path.join(repoPath, 'README.md'), '# Test Repo');
    await git.add('.');
    await git.commit('Initial commit');
  });

  afterEach(async () => {
    // 1. Remove all worktrees explicitly first to avoid resource locks
    try {
      const gitInstance = simpleGit(repoPath);
      const list = await gitInstance.raw(['worktree', 'list', '--porcelain']);
      const worktreePaths = list
        .split('\n')
        .filter((l) => l.startsWith('worktree '))
        .map((l) => l.substring(9).trim())
        .filter((p) => p !== repoPath);

      for (const p of worktreePaths) {
        await gitInstance.raw(['worktree', 'remove', '--force', p]).catch(() => {
          // ignore
        });
      }
    } catch {
      // ignore
    }

    // 2. Clean up directories
    await fs.rm(repoPath, { recursive: true, force: true }).catch(() => {
      // ignore
    });
    await fs.rm(testBaseDir, { recursive: true, force: true }).catch(() => {
      // ignore
    });
  });

  it('should create a worktree successfully', async () => {
    const sessionId = 'session-123';
    const taskSlug = 'my-task';
    const headSha = (await git.revparse(['HEAD'])).trim();

    const result = await worktreeManager.create(repoPath, sessionId, taskSlug);

    expect(result.path).toContain(sessionId);
    expect(result.branch).toBe(`agentctl/${sessionId}/${taskSlug}`);
    expect(result.baseCommit).toBe(headSha);

    const stats = await fs.stat(result.path);
    expect(stats.isDirectory()).toBe(true);

    const branches = await git.branch();
    expect(branches.all).toContain(result.branch);
  });

  it('should sanitize paths and branch names', async () => {
    const sessionId = 'session/../danger';
    const taskSlug = 'task with spaces and !@#';

    const result = await worktreeManager.create(repoPath, sessionId, taskSlug);

    expect(result.path).toContain('session-danger');
    expect(result.branch).toContain('task-with-spaces-and-');

    const stats = await fs.stat(result.path);
    expect(stats.isDirectory()).toBe(true);
  });

  it('should serialize parallel create calls using GitMutex', async () => {
    const sessionId1 = 'session-1';
    const sessionId2 = 'session-2';
    const taskSlug = 'task';

    const [res1, res2] = await Promise.all([
      worktreeManager.create(repoPath, sessionId1, taskSlug),
      worktreeManager.create(repoPath, sessionId2, taskSlug),
    ]);

    expect(res1.path).not.toBe(res2.path);
    expect(res1.branch).not.toBe(res2.branch);

    const branches = await git.branch();
    expect(branches.all).toContain(res1.branch);
    expect(branches.all).toContain(res2.branch);
  });

  it('should throw error if the branch already exists', async () => {
    const sessionId = 'session-exists';
    const taskSlug = 'task';
    const branchName = `agentctl/${sessionId}/${taskSlug}`;

    await git.checkoutLocalBranch(branchName);
    await git.checkout('main');

    await expect(worktreeManager.create(repoPath, sessionId, taskSlug)).rejects.toThrow(
      /already exists/
    );
  });

  it('should identify orphan worktrees', async () => {
    const activeSessionId = 'active-session';
    await worktreeManager.create(repoPath, activeSessionId, 'task-1');

    const orphanSessionId = 'orphan-session';
    const orphanResult = await worktreeManager.create(repoPath, orphanSessionId, 'task-2');

    const orphans = await worktreeManager.listOrphans(repoPath, [activeSessionId]);

    expect(orphans).toHaveLength(1);
    expect(orphans[0].path).toBe(orphanResult.path);
    expect(orphans[0].branch).toBe(orphanResult.branch);
  });

  it('should cleanup worktree and branch', async () => {
    const sessionId = 'cleanup-session';
    const taskSlug = 'task';
    const result = await worktreeManager.create(repoPath, sessionId, taskSlug);

    await worktreeManager.cleanup(repoPath, result.path, result.branch);

    await expect(fs.stat(result.path)).rejects.toThrow();
    const branches = await git.branch();
    expect(branches.all).not.toContain(result.branch);
  });

  it('should sync and remove multiple orphans', async () => {
    const res1 = await worktreeManager.create(repoPath, 'orphan-1', 'task');
    const res2 = await worktreeManager.create(repoPath, 'orphan-2', 'task');
    const activeId = 'active';
    const resActive = await worktreeManager.create(repoPath, activeId, 'task');

    await worktreeManager.sync(repoPath, [activeId]);

    await expect(fs.stat(res1.path)).rejects.toThrow();
    await expect(fs.stat(res2.path)).rejects.toThrow();
    const stats = await fs.stat(resActive.path);
    expect(stats.isDirectory()).toBe(true);

    const branches = await git.branch();
    expect(branches.all).not.toContain(res1.branch);
    expect(branches.all).not.toContain(res2.branch);
    expect(branches.all).toContain(resActive.branch);
  });

  it('should get a diff from a worktree', async () => {
    const sessionId = 'diff-session';
    const taskSlug = 'task';
    const result = await worktreeManager.create(repoPath, sessionId, taskSlug);

    const filePath = path.join(result.path, 'new-file.md');
    await fs.writeFile(filePath, 'New content');

    const wtGit = simpleGit(result.path);
    await wtGit.add('.');
    await wtGit.commit('Work in progress');

    const diff = await worktreeManager.getDiff(repoPath, result.path, result.baseCommit);

    expect(diff).toContain('new-file.md');
    expect(diff).toContain('+New content');
  });

  it('should finalize a worktree with a squash merge', async () => {
    const sessionId = 'merge-session';
    const taskSlug = 'feat-cool-thing';
    const result = await worktreeManager.create(repoPath, sessionId, taskSlug);

    const filePath = path.join(result.path, 'cool-file.md');
    await fs.writeFile(filePath, 'Cool content');
    const wtGit = simpleGit(result.path);
    await wtGit.add('.');
    await wtGit.commit('Agent work');

    await worktreeManager.finalize(repoPath, result.path, result.branch, 'main', 'merge', taskSlug);

    await expect(fs.stat(result.path)).rejects.toThrow();
    const branches = await git.branch();
    expect(branches.all).not.toContain(result.branch);

    const log = await git.log();
    expect(log.latest?.message).toBe(taskSlug);
    const content = await fs.readFile(path.join(repoPath, 'cool-file.md'), 'utf8');
    expect(content).toBe('Cool content');
  });

  it('should not cleanup if merge fails (conflict)', async () => {
    const sessionId = 'conflict-session';
    const taskSlug = 'conflict-task';
    const result = await worktreeManager.create(repoPath, sessionId, taskSlug);

    await fs.writeFile(path.join(repoPath, 'README.md'), '# Main change');
    await git.add('.');
    await git.commit('Conflict base');

    const wtGit = simpleGit(result.path);
    await fs.writeFile(path.join(result.path, 'README.md'), '# Worktree change');
    await wtGit.add('.');
    await wtGit.commit('Conflict work');

    await expect(
      worktreeManager.finalize(repoPath, result.path, result.branch, 'main', 'merge', taskSlug)
    ).rejects.toThrow();

    const stats = await fs.stat(result.path);
    expect(stats.isDirectory()).toBe(true);
    const branches = await git.branch();
    expect(branches.all).toContain(result.branch);
  });
});
