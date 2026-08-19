import { test, expect, describe, beforeAll, afterAll } from 'vitest';
import { WorkspaceManager, parsePorcelainWorktrees } from './worktree-manager.js';
import { GitMutex } from './mutex.js';
import { simpleGit } from 'simple-git';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

describe('parsePorcelainWorktrees (Unit Tests)', () => {
  test('should correctly parse null-delimited porcelain output with branch, detached, and prunable entries', () => {
    const rawOutput = [
      'worktree /path/to/main repo',
      'HEAD 1111111111111111111111111111111111111111',
      'branch refs/heads/main',
      '',
      'worktree /path/to/worktree-1',
      'HEAD 2222222222222222222222222222222222222222',
      'branch refs/heads/feature/awesome',
      '',
      'worktree /path/to/detached-wt',
      'HEAD 3333333333333333333333333333333333333333',
      'detached',
      '',
      'worktree /path/to/prunable-wt',
      'HEAD 4444444444444444444444444444444444444444',
      'branch refs/heads/old-branch',
      'prunable gitdir file points to non-existent location',
      '',
    ].join('\0');

    const result = parsePorcelainWorktrees(rawOutput);
    expect(result).toEqual([
      { path: '/path/to/main repo', branch: 'main' },
      { path: '/path/to/worktree-1', branch: 'feature/awesome' },
      { path: '/path/to/detached-wt', branch: 'HEAD' },
    ]);
  });
});

describe('WorkspaceManager Integration Tests', () => {
  let tempDir: string;
  let repoPath: string;
  let worktreeBaseDir: string;
  let manager: WorkspaceManager;

  beforeAll(async () => {
    // Set up a temporary directory for our integration tests
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agentctl-git-tests-'));
    repoPath = path.join(tempDir, 'repo');
    worktreeBaseDir = path.join(tempDir, 'worktrees');

    await fs.mkdir(repoPath, { recursive: true });
    await fs.mkdir(worktreeBaseDir, { recursive: true });

    // Initialize an actual git repository on disk
    const git = simpleGit(repoPath);
    await git.init();
    await git.addConfig('user.name', 'Test User');
    await git.addConfig('user.email', 'test@example.com');
    await git.addConfig('commit.gpgSign', 'false');

    // Create an initial commit so the repository is not empty
    const testFile = path.join(repoPath, 'hello.txt');
    await fs.writeFile(testFile, 'initial content');
    await git.add('hello.txt');
    await git.commit('Initial commit');

    const mutex = new GitMutex();
    manager = new WorkspaceManager(mutex, worktreeBaseDir);
  });

  afterAll(async () => {
    // Clean up all test directories
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  });

  test('should resolve repository info correctly', async () => {
    const info = await manager.resolveRepository(repoPath);
    expect(info.isGitRepo).toBe(true);
    expect(info.repoRoot).toBe(path.resolve(repoPath));
    expect(info.workdirPrefix).toBe('');
  });

  test('should manage workspace lifecycle (acquire, stage, diff, release)', async () => {
    const sessionId = 'test-session-id';
    const taskSlug = 'add-feature';

    // 1. Create/Acquire the workspace
    const result = await manager.create(repoPath, sessionId, taskSlug, 'master');
    expect(result.branch).toContain(sessionId);
    expect(result.branch).toContain(taskSlug);

    const workspace = manager.getWorkspace(
      repoPath,
      sessionId,
      taskSlug,
      result.path,
      result.baseCommit,
      result.branch,
    );

    expect(workspace.path).toBe(result.path);
    expect(workspace.branch).toBe(result.branch);

    // Ensure the worktree directory was created on disk
    const stat = await fs.stat(workspace.path);
    expect(stat.isDirectory()).toBe(true);

    // 2. Modify a file in the workspace
    const workspaceFile = path.join(workspace.path, 'feature.txt');
    await fs.writeFile(workspaceFile, 'my new feature');

    // Check review files - should be untracked
    let reviewFiles = await workspace.getReviewFiles();
    expect(reviewFiles.length).toBe(1);
    expect(reviewFiles[0].path).toBe('feature.txt');
    expect(reviewFiles[0].state).toBe('untracked');

    // 3. Stage the file
    await workspace.stageFile('feature.txt');
    reviewFiles = await workspace.getReviewFiles();
    expect(reviewFiles[0].state).toBe('staged');

    // Commit in the worktree so the branch has the changes
    await simpleGit(workspace.path).commit('feat: add feature');

    // 4. Release with merge
    await manager.finalize(
      repoPath,
      workspace.path,
      workspace.branch,
      'master',
      'merge',
      taskSlug,
      'feat: merge my new feature',
    );

    // Verify main repository has the changes merged
    const mainFileContent = await fs.readFile(path.join(repoPath, 'feature.txt'), 'utf-8');
    expect(mainFileContent).toBe('my new feature');

    // Verify directory is deleted
    await expect(fs.stat(workspace.path)).rejects.toThrow();
  });

  test('should safely refresh branch with fast-forward, non-ancestor pre-refresh recording, and dirty protection', async () => {
    const sessionId = 'test-refresh-session';
    const taskSlug = 'refresh-test';

    // 1. Create a worktree
    const result = await manager.create(repoPath, sessionId, taskSlug, 'master');
    const wtGit = simpleGit(result.path);

    // Create an initial commit on main
    await fs.writeFile(path.join(repoPath, 'main-update.txt'), 'main update 1');
    await simpleGit(repoPath).add('main-update.txt');
    await simpleGit(repoPath).commit('main update 1');
    const mainCommit1 = (await simpleGit(repoPath).revparse(['HEAD'])).trim();

    // Fast-forward refresh to main
    const ffResult = await manager.refreshBranch(repoPath, result.path, 'master');
    expect(ffResult.moved).toBe(true);
    expect(ffResult.headCommit).toBe(mainCommit1);

    // 2. Reject refresh if worktree is dirty when a new commit is available on main
    await fs.writeFile(path.join(repoPath, 'main-update-2.txt'), 'main update 2');
    await simpleGit(repoPath).add('main-update-2.txt');
    await simpleGit(repoPath).commit('main update 2');

    await fs.writeFile(path.join(result.path, 'uncommitted.txt'), 'dirty work');
    await expect(manager.refreshBranch(repoPath, result.path, 'master')).rejects.toThrow(
      'uncommitted changes',
    );
    await fs.rm(path.join(result.path, 'uncommitted.txt'));

    // 3. Make a commit on the worktree branch
    await fs.writeFile(path.join(result.path, 'worktree-commit.txt'), 'local worktree commit');
    await wtGit.add('worktree-commit.txt');
    await wtGit.commit('local worktree commit');
    const previousWtCommit = (await wtGit.revparse(['HEAD'])).trim();

    // Now rewrite/amend main on host repo so it is NOT an ancestor
    await fs.writeFile(path.join(repoPath, 'rewritten.txt'), 'rewritten content');
    await simpleGit(repoPath).add('rewritten.txt');
    await simpleGit(repoPath).commit('amended commit', ['--amend']);
    const amendedMainCommit = (await simpleGit(repoPath).revparse(['HEAD'])).trim();

    // Refresh branch onto amended main (non-ancestor)
    const resetResult = await manager.refreshBranch(repoPath, result.path, 'master');
    expect(resetResult.moved).toBe(true);
    expect(resetResult.headCommit).toBe(amendedMainCommit);

    // Verify pre-refresh ref was recorded
    const preRefreshRef = (await wtGit.revparse(['refs/agentctl/pre-refresh'])).trim();
    expect(preRefreshRef).toBe(previousWtCommit);

    // Clean up worktree
    await manager.removeWorktreeOnly(repoPath, result.path);
  });
});
