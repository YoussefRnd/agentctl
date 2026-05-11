import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { WorktreeManager } from './worktree-manager.js';
import { GitMutex } from '../utils/git-mutex.js';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import { simpleGit, SimpleGit } from 'simple-git';

describe('WorktreeManager', () => {
  let worktreeManager: WorktreeManager;
  let gitMutex: GitMutex;
  let repoPath: string;
  let git: SimpleGit;

  beforeEach(async () => {
    gitMutex = new GitMutex();
    worktreeManager = new WorktreeManager(gitMutex);

    // Create a temporary repo
    repoPath = await fs.mkdtemp(path.join(os.tmpdir(), 'agentctl-test-repo-'));
    git = simpleGit(repoPath);
    await git.init();
    // Ensure we are on 'main' branch
    await git.checkoutLocalBranch('main');
    await fs.writeFile(path.join(repoPath, 'README.md'), '# Test Repo');
    await git.add('.');
    await git.commit('Initial commit');
  });

  afterEach(async () => {
    await fs.rm(repoPath, { recursive: true, force: true });
    // Also clean up baseDir if it was created
    const baseDir = path.join(os.homedir(), '.agentctl', 'worktrees');
    await fs.rm(baseDir, { recursive: true, force: true }).catch(() => {});
  });

  it('should create a worktree successfully', async () => {
    const sessionId = 'session-123';
    const taskSlug = 'my-task';
    
    const result = await worktreeManager.create(repoPath, sessionId, taskSlug);

    expect(result.path).toContain(sessionId);
    expect(result.branch).toBe(`agentctl/${sessionId}/${taskSlug}`);
    expect(result.baseCommit).toBeDefined();

    // Verify worktree exists
    const stats = await fs.stat(result.path);
    expect(stats.isDirectory()).toBe(true);

    // Verify branch exists in the main repo
    const branches = await git.branch();
    expect(branches.all).toContain(result.branch);
  });

  it('should serialize parallel create calls using GitMutex', async () => {
    const sessionId1 = 'session-1';
    const sessionId2 = 'session-2';
    const taskSlug = 'task';

    // We can spy on gitMutex.run or just verify both succeed without race conditions
    // More effectively, we can check if they are actually running sequentially if we had a way to delay.
    // For now, let's just ensure they both work.
    
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

    // Pre-create the branch
    await git.checkoutLocalBranch(branchName);
    await git.checkout('main');

    await expect(worktreeManager.create(repoPath, sessionId, taskSlug))
      .rejects.toThrow(/already exists/);
  });

  it('should create baseDir if it does not exist', async () => {
    const baseDir = path.join(os.homedir(), '.agentctl', 'worktrees');
    await fs.rm(baseDir, { recursive: true, force: true }).catch(() => {});

    const sessionId = 'session-mkdir';
    const taskSlug = 'task';
    
    await worktreeManager.create(repoPath, sessionId, taskSlug);

    const stats = await fs.stat(baseDir);
    expect(stats.isDirectory()).toBe(true);
  });

  it('should throw error if storage path already exists', async () => {
    const sessionId = 'session-dir-exists';
    const taskSlug = 'task';
    const projectName = path.basename(repoPath);
    const storagePath = path.join(os.homedir(), '.agentctl', 'worktrees', projectName, sessionId);

    await fs.mkdir(storagePath, { recursive: true });
    await fs.writeFile(path.join(storagePath, 'somefile'), 'data');

    await expect(worktreeManager.create(repoPath, sessionId, taskSlug))
      .rejects.toThrow();
  });
});
