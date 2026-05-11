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
    const headSha = (await git.revparse(['HEAD'])).trim();
    
    const result = await worktreeManager.create(repoPath, sessionId, taskSlug);

    expect(result.path).toContain(sessionId);
    expect(result.branch).toBe(`agentctl/${sessionId}/${taskSlug}`);
    expect(result.baseCommit).toBe(headSha); // Verify it matches the base SHA

    // Verify worktree exists
    const stats = await fs.stat(result.path);
    expect(stats.isDirectory()).toBe(true);

    // Verify branch exists in the main repo
    const branches = await git.branch();
    expect(branches.all).toContain(result.branch);
  });

  it('should sanitize paths and branch names', async () => {
    const sessionId = 'session/../danger';
    const taskSlug = 'task with spaces and !@#';
    
    const result = await worktreeManager.create(repoPath, sessionId, taskSlug);

    // Should be sanitized to session-danger
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

  it('should identify orphan worktrees', async () => {
    // 1. Create a "valid" worktree
    const activeSessionId = 'active-session';
    await worktreeManager.create(repoPath, activeSessionId, 'task-1');

    // 2. Create an "orphan" worktree
    const orphanSessionId = 'orphan-session';
    const orphanResult = await worktreeManager.create(repoPath, orphanSessionId, 'task-2');

    // 3. List orphans providing only the active session ID
    // Note: session IDs in branch names are sanitized.
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

    // Verify worktree is gone from disk
    await expect(fs.stat(result.path)).rejects.toThrow();

    // Verify branch is gone from git
    const branches = await git.branch();
    expect(branches.all).not.toContain(result.branch);

    // Verify worktree is gone from git list
    const worktrees = await git.raw(['worktree', 'list']);
    expect(worktrees).not.toContain(result.path);
  });

  it('should sync and remove multiple orphans', async () => {
    // 1. Create two orphans
    const res1 = await worktreeManager.create(repoPath, 'orphan-1', 'task');
    const res2 = await worktreeManager.create(repoPath, 'orphan-2', 'task');

    // 2. Create one active
    const activeId = 'active';
    const resActive = await worktreeManager.create(repoPath, activeId, 'task');

    // 3. Sync with only 'active' as active
    await worktreeManager.sync(repoPath, [activeId]);

    // Verify orphans are gone from disk
    await expect(fs.stat(res1.path)).rejects.toThrow();
    await expect(fs.stat(res2.path)).rejects.toThrow();

    // Verify active is still there
    const stats = await fs.stat(resActive.path);
    expect(stats.isDirectory()).toBe(true);

    // Verify branches
    const branches = await git.branch();
    expect(branches.all).not.toContain(res1.branch);
    expect(branches.all).not.toContain(res2.branch);
    expect(branches.all).toContain(resActive.branch);
  });

  it('should get a diff from a worktree', async () => {
    const sessionId = 'diff-session';
    const taskSlug = 'task';
    const result = await worktreeManager.create(repoPath, sessionId, taskSlug);

    // Make a change in the worktree
    const filePath = path.join(result.path, 'new-file.md');
    await fs.writeFile(filePath, 'New content');

    // Must commit for ...HEAD to show changes
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

    // Make a change in the worktree
    const filePath = path.join(result.path, 'cool-file.md');
    await fs.writeFile(filePath, 'Cool content');
    const wtGit = simpleGit(result.path);
    await wtGit.add('.');
    await wtGit.commit('Agent work');

    // Finalize with merge
    await worktreeManager.finalize(
      repoPath,
      result.path,
      result.branch,
      'main',
      'merge',
      taskSlug
    );

    // Verify worktree and branch are gone
    await expect(fs.stat(result.path)).rejects.toThrow();
    const branches = await git.branch();
    expect(branches.all).not.toContain(result.branch);

    // Verify changes are in main
    await git.checkout('main');
    const log = await git.log();
    expect(log.latest?.message).toBe(taskSlug); // Should be committed with task slug
    const content = await fs.readFile(path.join(repoPath, 'cool-file.md'), 'utf8');
    expect(content).toBe('Cool content');
  });

  it('should finalize a worktree with discard', async () => {
    const sessionId = 'discard-session';
    const taskSlug = 'discard-task';
    const result = await worktreeManager.create(repoPath, sessionId, taskSlug);

    // Make a change
    await fs.writeFile(path.join(result.path, 'trash.md'), 'Trash');

    // Finalize with discard
    await worktreeManager.finalize(
      repoPath,
      result.path,
      result.branch,
      'main',
      'discard'
    );

    // Verify worktree and branch are gone
    await expect(fs.stat(result.path)).rejects.toThrow();
    const branches = await git.branch();
    expect(branches.all).not.toContain(result.branch);

    // Verify main is clean
    await git.checkout('main');
    await expect(fs.stat(path.join(repoPath, 'trash.md'))).rejects.toThrow();
  });
});
