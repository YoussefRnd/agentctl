import { test, expect, describe, beforeAll, afterAll } from 'vitest';
import { WorkspaceManager } from './worktree-manager.js';
import { GitMutex } from '../utils/git-mutex.js';
import { simpleGit } from 'simple-git';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

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
});
