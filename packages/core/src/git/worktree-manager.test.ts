import { test, expect, describe, beforeAll, afterAll } from 'vitest';
import {
  WorkspaceManager,
  parseGitHubRemoteUrl,
  parsePorcelainWorktrees,
} from './worktree-manager.js';
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

describe('parseGitHubRemoteUrl', () => {
  test.each([
    ['git@github.com:agentctl/agentctl.git', 'https://github.com/agentctl/agentctl'],
    ['https://github.com/agentctl/agentctl.git', 'https://github.com/agentctl/agentctl'],
    ['https://github.com/agentctl/agentctl', 'https://github.com/agentctl/agentctl'],
    ['https://gitlab.com/agentctl/agentctl.git', null],
    ['ssh://git@github.com:22/agentctl/agentctl.git', 'https://github.com/agentctl/agentctl'],
    ['https://github.com.evil.example/agentctl/agentctl.git', null],
    ['https://notgithub.com/agentctl/agentctl.git', null],
    ['/tmp/github.com/agentctl/agentctl.git', null],
  ])('normalizes %s', (remote, expected) => {
    expect(parseGitHubRemoteUrl(remote)).toBe(expected);
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

  test('does not reuse a worktree missing from the caller database', async () => {
    const foreign = await manager.create(repoPath, 'foreign-session', 'shared-slug', 'master');
    await fs.writeFile(path.join(foreign.path, 'unsaved.txt'), 'keep these changes');
    const own = await manager.create(repoPath, 'own-session', 'shared-slug', 'master', '', []);
    expect(own.path).not.toBe(foreign.path);
    expect(await fs.readFile(path.join(foreign.path, 'unsaved.txt'), 'utf8')).toBe(
      'keep these changes',
    );
    expect((await simpleGit(foreign.path).branch()).current).toBe(foreign.branch);
  });

  test('reserves different worktree paths for concurrent drafts with the same slug', async () => {
    const [first, second] = await Promise.all([
      manager.create(repoPath, 'concurrent-a', 'same-slug', 'master'),
      manager.create(repoPath, 'concurrent-b', 'same-slug', 'master'),
    ]);
    expect(first.path).not.toBe(second.path);
    expect((await simpleGit(first.path).branch()).current).toBe(first.branch);
    expect((await simpleGit(second.path).branch()).current).toBe(second.branch);
  });

  test('startup sync only removes finalized worktrees belonging to its database', async () => {
    const foreign = await manager.create(repoPath, 'other-database', 'other-database', 'master');
    const active = await manager.create(repoPath, 'known-active', 'known-active', 'master');
    const finalized = await manager.create(
      repoPath,
      'known-finalized',
      'known-finalized',
      'master',
    );
    await fs.writeFile(path.join(foreign.path, 'unsaved.txt'), 'keep foreign work');

    await manager.sync(repoPath, ['known-active'], ['known-active', 'known-finalized']);
    expect((await fs.stat(active.path)).isDirectory()).toBe(true);
    expect(await fs.readFile(path.join(foreign.path, 'unsaved.txt'), 'utf8')).toBe(
      'keep foreign work',
    );
    await expect(fs.stat(finalized.path)).rejects.toThrow();
    expect(await manager.listBranches(repoPath)).toContain(foreign.branch);
    expect(await manager.listBranches(repoPath)).not.toContain(finalized.branch);
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

    // Keep the source history and local files until explicit session deletion.
    expect((await fs.stat(workspace.path)).isDirectory()).toBe(true);
    expect(await manager.listBranches(repoPath)).toContain(result.branch);
  });

  test('refreshes only by fast-forward and preserves dirty files and diverged commits', async () => {
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

    // Diverged history must never silently reset away session commits.
    await expect(manager.refreshBranch(repoPath, result.path, 'master')).rejects.toThrow(
      'diverged',
    );
    expect((await wtGit.revparse(['HEAD'])).trim()).toBe(previousWtCommit);
    expect((await simpleGit(repoPath).revparse(['HEAD'])).trim()).toBe(amendedMainCommit);
    expect(await fs.readFile(path.join(result.path, 'worktree-commit.txt'), 'utf8')).toBe(
      'local worktree commit',
    );

    // Clean up worktree
    await manager.removeWorktreeOnly(repoPath, result.path);
  });

  test('requires committed changes and a configured remote before creating a pull request', async () => {
    const result = await manager.create(repoPath, 'test-pr-session', 'pr-preflight', 'master');
    await fs.writeFile(path.join(result.path, 'uncommitted.txt'), 'dirty work');

    await expect(
      manager.createPullRequest(repoPath, result.path, {
        title: 'Test pull request',
        body: '',
        baseBranch: 'master',
      }),
    ).rejects.toThrow('Commit or discard all working tree changes');

    await fs.rm(path.join(result.path, 'uncommitted.txt'));
    await expect(
      manager.createPullRequest(repoPath, result.path, {
        title: 'Test pull request',
        body: '',
        baseBranch: 'master',
      }),
    ).rejects.toThrow('No Git remote is configured');

    await manager.removeWorktreeOnly(repoPath, result.path);
  });

  test('revertFile correctly reverts modified, untracked, and staged newly added files without pathspec errors', async () => {
    const result = await manager.create(repoPath, 'test-revert-session', 'revert-test', 'master');
    const wtPath = result.path;
    const wtGit = simpleGit(wtPath);

    // 1. Existing modified file
    const existingFilePath = path.join(wtPath, 'hello.txt');
    const originalContent = await fs.readFile(existingFilePath, 'utf8');
    await fs.writeFile(existingFilePath, 'modified content');
    expect(await fs.readFile(existingFilePath, 'utf8')).toBe('modified content');

    await manager.revertFile(repoPath, wtPath, 'hello.txt');
    expect(await fs.readFile(existingFilePath, 'utf8')).toBe(originalContent);

    // 2. Untracked newly created file
    const untrackedFile = path.join(wtPath, 'untracked.txt');
    await fs.writeFile(untrackedFile, 'new untracked file');
    expect(
      await fs
        .stat(untrackedFile)
        .then(() => true)
        .catch(() => false),
    ).toBe(true);

    await manager.revertFile(repoPath, wtPath, 'untracked.txt');
    expect(
      await fs
        .stat(untrackedFile)
        .then(() => true)
        .catch(() => false),
    ).toBe(false);

    // 3. Staged newly created file (e.g. Dockerfile)
    const stagedNewFile = path.join(wtPath, 'Dockerfile');
    await fs.writeFile(stagedNewFile, 'FROM node:20');
    await wtGit.add('Dockerfile');
    const statusBefore = await wtGit.status();
    expect(statusBefore.staged).toContain('Dockerfile');

    await manager.revertFile(repoPath, wtPath, 'Dockerfile');
    expect(
      await fs
        .stat(stagedNewFile)
        .then(() => true)
        .catch(() => false),
    ).toBe(false);
    const statusAfter = await wtGit.status();
    expect(statusAfter.staged).not.toContain('Dockerfile');

    await manager.removeWorktreeOnly(repoPath, wtPath);
  });
});
