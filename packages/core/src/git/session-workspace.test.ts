import { createDefaultRepositoryService } from '../default-repository-service.js';
import { legacyGitRevision } from './legacy-revisions.js';
import { test, expect, describe, beforeAll, afterEach, beforeEach } from 'vitest';
import { SessionWorkspace } from './session-workspace.js';
import { WorkspaceManager } from './worktree-manager.js';
import { GitMutex } from './mutex.js';
import { createDatabase } from '../db/index.js';
import { projects, sessions, sessionEvents } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { simpleGit } from 'simple-git';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import type { DbClient } from '../db/index.js';
import { SnapshotService } from './snapshot-service.js';

describe('SessionWorkspace Integration Tests (Mock-Free)', () => {
  let tempDir: string;
  let repoPath: string;
  let worktreeBaseDir: string;
  let db: DbClient;
  let workspaceManager: WorkspaceManager;
  let sessionWorkspace: SessionWorkspace;
  let stopSessionCalled = false;

  beforeAll(() => {
    // Set up database (using real sqlite in-memory schema)
    db = createDatabase(':memory:');
  });

  beforeEach(async () => {
    stopSessionCalled = false;

    // Set up a temporary directory for Git repos and worktrees
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agentctl-session-workspace-tests-'));
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
    workspaceManager = new WorkspaceManager(mutex, worktreeBaseDir);

    const snapshotService = new SnapshotService(path.join(tempDir, 'snapshots'));

    sessionWorkspace = new SessionWorkspace(
      db,
      workspaceManager,
      (_sessionId) => {
        stopSessionCalled = true;
      },
      () => snapshotService,
    );
  });

  afterEach(async () => {
    // Clean up test directory
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  });

  async function establishDraft(projectId: string) {
    await db
      .insert(projects)
      .values({ id: projectId, name: projectId, path: repoPath, repoRoot: repoPath });
    return sessionWorkspace.establish(projectId, projectId, {
      mode: 'worktree',
      selectedProvider: 'test-provider',
      selectedModel: 'default',
    });
  }

  test('restores a missing idle worktree from its branch without changing its baseline', async () => {
    const context = await establishDraft('recover-branch');
    await fs.writeFile(path.join(context.worktreePath, 'feature.txt'), 'committed feature');
    const git = simpleGit(context.worktreePath);
    await git.add('feature.txt');
    await git.commit('Feature');
    const head = (await git.revparse(['HEAD'])).trim();
    await db.insert(sessionEvents).values({
      sessionId: context.sessionId,
      type: 'text',
      data: JSON.stringify({ role: 'user', content: 'Build feature' }),
    });
    // Simulate external removal, leaving Git's administrative entry stale.
    await fs.rm(context.worktreePath, { recursive: true });

    expect(await sessionWorkspace.ensureAvailable(context.sessionId)).toBe(true);
    expect(stopSessionCalled).toBe(true);
    expect(await fs.readFile(path.join(context.worktreePath, 'feature.txt'), 'utf8')).toBe(
      'committed feature',
    );
    expect((await git.revparse(['HEAD'])).trim()).toBe(head);
    const record = await db.query.sessions.findFirst({ where: eq(sessions.id, context.sessionId) });
    expect(record?.baseCommit).toBe(context.baseCommit);
    expect(record?.branch).toBe(context.branch);
    expect(record?.worktreePath).toBe(context.worktreePath);
  });

  test('recreates an unused missing draft from its saved commit, not the current project HEAD', async () => {
    const context = await establishDraft('recover-draft');
    await workspaceManager.cleanup(repoPath, context.worktreePath, context.branch);
    await fs.writeFile(path.join(repoPath, 'hello.txt'), 'new project content');
    await simpleGit(repoPath).add('hello.txt');
    await simpleGit(repoPath).commit('Advance project');
    await fs.writeFile(path.join(repoPath, '.env.test'), 'TEST_VALUE=example');
    // Metadata does not turn an unused draft into a conversation.
    await db
      .insert(sessionEvents)
      .values({ sessionId: context.sessionId, type: 'status', data: '{}' });

    const results = await Promise.all([
      sessionWorkspace.ensureAvailable(context.sessionId),
      sessionWorkspace.ensureAvailable(context.sessionId),
    ]);
    expect(results).toEqual([true, true]);
    expect(await fs.readFile(path.join(context.worktreePath, 'hello.txt'), 'utf8')).toBe(
      'initial content',
    );
    expect(await fs.readFile(path.join(context.worktreePath, '.env.test'), 'utf8')).toBe(
      'TEST_VALUE=example',
    );
    expect((await simpleGit(context.worktreePath).revparse(['HEAD'])).trim()).toBe(
      await legacyGitRevision(
        await createDefaultRepositoryService(new SnapshotService()).open(context.worktreePath),
        context.baseCommit,
      ),
    );
  });

  test('refuses to recreate a missing conversation branch from an unrelated baseline', async () => {
    const context = await establishDraft('missing-history');
    await db.insert(sessionEvents).values({
      sessionId: context.sessionId,
      type: 'text',
      data: JSON.stringify({ role: 'user', content: 'Existing conversation' }),
    });
    await workspaceManager.cleanup(repoPath, context.worktreePath, context.branch);

    await expect(sessionWorkspace.ensureAvailable(context.sessionId)).rejects.toMatchObject({
      statusCode: 409,
      message: expect.stringContaining('session branch is also missing'),
    });
    await expect(fs.stat(context.worktreePath)).rejects.toThrow();
  });

  test('leaves an existing dirty worktree untouched', async () => {
    const context = await establishDraft('existing-dirty');
    await fs.writeFile(path.join(context.worktreePath, 'hello.txt'), 'unsaved changes');
    expect(await sessionWorkspace.ensureAvailable(context.sessionId)).toBe(false);
    expect(stopSessionCalled).toBe(false);
    expect(await fs.readFile(path.join(context.worktreePath, 'hello.txt'), 'utf8')).toBe(
      'unsaved changes',
    );
  });

  test('should establish, activate, getHandle, archive, finalize, and teardown workspace lifecycle in worktree mode', async () => {
    const projectId = 'project-wt-1';

    // 1. Setup project in DB
    await db.insert(projects).values({
      id: projectId,
      name: 'Worktree Test Project',
      path: repoPath,
      repoRoot: repoPath,
      subdir: '',
    });

    // 2. Establish Session Workspace
    const context = await sessionWorkspace.establish(projectId, 'wt-slug', {
      mode: 'worktree',
      selectedProvider: 'test-provider',
      selectedModel: 'default',
    });

    expect(context.sessionId).toBeDefined();
    expect(context.mode).toBe('worktree');
    expect(context.branch).toContain('wt-slug');

    const sessionRecord = await db.query.sessions.findFirst({
      where: eq(sessions.id, context.sessionId),
    });
    expect(sessionRecord).toBeDefined();
    expect(sessionRecord?.status).toBe('idle');
    expect(sessionRecord?.mode).toBe('worktree');
    expect(sessionRecord?.title).toBe('New Session');

    // 3. getHandle and write some files
    const handle = await sessionWorkspace.getHandle(context.sessionId);
    expect(handle.path).toBe(context.worktreePath);

    const fileInWt = path.join(handle.path, 'wt-feature.txt');
    await fs.writeFile(fileInWt, 'worktree feature content');

    let reviewFiles = await handle.getReviewFiles();
    expect(reviewFiles.length).toBe(1);
    expect(reviewFiles[0].path).toBe('wt-feature.txt');
    expect(reviewFiles[0].state).toBe('untracked');

    // Stage file
    await handle.stageFile('wt-feature.txt');
    reviewFiles = await handle.getReviewFiles();
    expect(reviewFiles[0].state).toBe('staged');

    // Commit file inside worktree
    await simpleGit(handle.path).commit('feat: worktree changes');

    // 4. Archive Session
    await sessionWorkspace.archive(context.sessionId);
    expect(stopSessionCalled).toBe(true);

    const archivedRecord = await db.query.sessions.findFirst({
      where: eq(sessions.id, context.sessionId),
    });
    expect(archivedRecord?.status).toBe('archived');

    // Archive retains files and staging so resuming cannot lose uncommitted work.
    expect((await fs.stat(context.worktreePath)).isDirectory()).toBe(true);

    // 5. Activate / Resuscitate Session
    stopSessionCalled = false;
    const reactivatedContext = await sessionWorkspace.activate(context.sessionId);
    expect(reactivatedContext.mode).toBe('worktree');

    const reactivatedRecord = await db.query.sessions.findFirst({
      where: eq(sessions.id, context.sessionId),
    });
    expect(reactivatedRecord?.status).toBe('idle');

    // Verify worktree folder exists again on disk
    const wtStat = await fs.stat(reactivatedContext.worktreePath);
    expect(wtStat.isDirectory()).toBe(true);

    // 6. Finalize Session (merge squash back to base branch)
    await sessionWorkspace.finalize(context.sessionId, 'merged', {
      commitMessage: 'feat: merge wt changes',
    });

    const finalizedRecord = await db.query.sessions.findFirst({
      where: eq(sessions.id, context.sessionId),
    });
    expect(finalizedRecord?.status).toBe('merged');

    // Verify changes are squashed and committed in main repo
    const hostFileContent = await fs.readFile(path.join(repoPath, 'wt-feature.txt'), 'utf-8');
    expect(hostFileContent).toBe('worktree feature content');

    // 7. Teardown Session
    await sessionWorkspace.teardown(context.sessionId);
    const deletedRecord = await db.query.sessions.findFirst({
      where: eq(sessions.id, context.sessionId),
    });
    expect(deletedRecord).toBeUndefined();
  });

  test('should establish, activate, getHandle, finalize (discard), and teardown workspace lifecycle in local mode', async () => {
    const projectId = 'project-local-1';

    // 1. Setup project in DB
    await db.insert(projects).values({
      id: projectId,
      name: 'Local Test Project',
      path: repoPath,
      repoRoot: repoPath,
      subdir: '',
    });

    // 2. Establish Session Workspace
    const context = await sessionWorkspace.establish(projectId, 'local-slug', {
      mode: 'local',
      selectedProvider: 'test-provider',
      selectedModel: 'default',
    });

    expect(context.mode).toBe('local');

    // 3. getHandle and write some files
    const handle = await sessionWorkspace.getHandle(context.sessionId);
    expect(handle.path).toBe(repoPath);

    const fileInLocal = path.join(repoPath, 'local-feature.txt');
    await fs.writeFile(fileInLocal, 'local feature content');

    const reviewFiles = await handle.getReviewFiles();
    expect(reviewFiles.length).toBe(1);
    expect(reviewFiles[0].path).toBe('local-feature.txt');

    // 4. Finalize with discard
    await sessionWorkspace.finalize(context.sessionId, 'discarded');

    const finalizedRecord = await db.query.sessions.findFirst({
      where: eq(sessions.id, context.sessionId),
    });
    expect(finalizedRecord?.status).toBe('discarded');

    // Verify local modifications are discarded/reverted
    await expect(fs.stat(fileInLocal)).rejects.toThrow();
  });

  test('should handle merge conflicts and transition session to error state, and then succeed once conflict is resolved', async () => {
    const projectId = 'project-wt-conflict';

    await db.insert(projects).values({
      id: projectId,
      name: 'Conflict Test Project',
      path: repoPath,
      repoRoot: repoPath,
      subdir: '',
    });

    const hostGit = simpleGit(repoPath);
    const baseBranch = (await hostGit.revparse(['--abbrev-ref', 'HEAD'])).trim();

    // 1. Establish Session
    const context = await sessionWorkspace.establish(projectId, 'conflict-slug', {
      mode: 'worktree',
      selectedProvider: 'test-provider',
      selectedModel: 'default',
    });

    // 2. Create conflict: modify hello.txt in the worktree
    const handle = await sessionWorkspace.getHandle(context.sessionId);
    const fileInWt = path.join(handle.path, 'hello.txt');
    await fs.writeFile(fileInWt, 'worktree conflict content');

    const wtGit = simpleGit(handle.path);
    await wtGit.add('hello.txt');
    await wtGit.commit('worktree change to hello.txt');

    // Also modify hello.txt in the host branch (base branch)
    await fs.writeFile(path.join(repoPath, 'hello.txt'), 'host conflict content');
    await hostGit.add('hello.txt');
    await hostGit.commit('host change to hello.txt');

    // 3. Attempt to finalize: this must fail with a merge conflict
    await expect(
      sessionWorkspace.finalize(context.sessionId, 'merged', {
        commitMessage: 'feat: merge conflict',
        baseBranch,
      }),
    ).rejects.toThrow();

    // Verify session status is 'error' in DB
    let sessionRecord = await db.query.sessions.findFirst({
      where: eq(sessions.id, context.sessionId),
    });
    expect(sessionRecord?.status).toBe('error');

    // Verify review files shows conflicted file
    let reviewFiles = await handle.getReviewFiles();
    const conflictedFile = reviewFiles.find((f) => f.path === 'hello.txt');
    expect(conflictedFile).toBeDefined();
    expect(conflictedFile?.state).toBe('conflicted');

    // 4. Resolve the conflict: edit hello.txt to remove markers, and stage it
    await fs.writeFile(fileInWt, 'resolved content');
    await handle.stageFile('hello.txt');

    // Verify status is no longer conflicted (it moves to staged)
    reviewFiles = await handle.getReviewFiles();
    const resolvedFile = reviewFiles.find((f) => f.path === 'hello.txt');
    expect(resolvedFile?.state).toBe('staged');

    // 5. Finalize session again: this must succeed now!
    await sessionWorkspace.finalize(context.sessionId, 'merged', {
      commitMessage: 'feat: resolved conflict merge',
      baseBranch,
    });

    sessionRecord = await db.query.sessions.findFirst({
      where: eq(sessions.id, context.sessionId),
    });
    expect(sessionRecord?.status).toBe('merged');

    // Verify host has the resolved content
    const hostFileContent = await fs.readFile(path.join(repoPath, 'hello.txt'), 'utf-8');
    expect(hostFileContent).toBe('resolved content');
  });
});
