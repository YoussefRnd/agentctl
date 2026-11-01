import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { WorkspaceManager, SessionWorkspace, GitMutex } from '@agentctl/core/git';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { ProviderRegistry } from '@agentctl/core/providers';
import { buildApp } from '../app.js';
import { createDatabase, projects, sessionEvents, sessions } from '@agentctl/core/db';

// Project route fixtures must not download or launch actual registry agents.
beforeEach(() => {
  vi.spyOn(ProviderRegistry.prototype, 'sync').mockResolvedValue();
  vi.spyOn(ProviderRegistry.prototype, 'autoUpdateInstalledProviders').mockResolvedValue();
  vi.spyOn(ProviderRegistry.prototype, 'probeAllInstalledProviders').mockResolvedValue();
  vi.spyOn(ProviderRegistry.prototype, 'recoverInterruptedOperations').mockResolvedValue();
});
afterEach(() => vi.restoreAllMocks());

describe('Projects routes', () => {
  let app: FastifyInstance;
  let db: ReturnType<typeof createDatabase>;
  const projectId = '10000000-0000-4000-8000-000000000001';
  const sessionWithMessageId = '20000000-0000-4000-8000-000000000001';
  const emptySessionId = '20000000-0000-4000-8000-000000000002';

  beforeEach(async () => {
    db = createDatabase(':memory:');

    await db.insert(projects).values({
      id: projectId,
      name: 'Project',
      path: '/tmp/project',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    });

    await db.insert(sessions).values([
      {
        id: sessionWithMessageId,
        projectId,
        branch: 'main',
        worktreePath: '/tmp/project',
        taskSlug: 'with-message',
        baseCommit: 'c0ffee',
        agent: 'test-agent',
        selectedProvider: 'test-provider',
        lastActivityAt: new Date('2026-01-02T00:00:00.000Z'),
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-09-14T12:00:00.000Z'),
      },
      {
        id: emptySessionId,
        projectId,
        branch: 'main',
        worktreePath: '/tmp/project',
        taskSlug: 'empty',
        baseCommit: 'c0ffee',
        agent: 'test-agent',
        selectedProvider: 'test-provider',
        lastActivityAt: new Date('2026-01-03T00:00:00.000Z'),
        createdAt: new Date('2026-01-03T00:00:00.000Z'),
        updatedAt: new Date('2026-01-03T00:00:00.000Z'),
      },
    ]);

    await db.insert(sessionEvents).values([
      {
        sessionId: sessionWithMessageId,
        type: 'text',
        data: JSON.stringify({ role: 'user', content: 'hello' }),
        createdAt: new Date('2026-01-02T00:00:00.000Z'),
      },
      {
        sessionId: sessionWithMessageId,
        type: 'status',
        data: JSON.stringify({ status: 'session_info_update' }),
        createdAt: new Date('2026-09-14T12:00:00.000Z'),
      },
    ]);

    app = await buildApp({ db, embedded: true });
  });

  afterEach(async () => {
    await app.close();
  });

  it('uses message activity instead of administrative session updates', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/projects' });

    expect(response.statusCode).toBe(200);
    const [project] = response.json() as Array<{
      sessions: Array<{ id: string; lastActivityAt: string; hasUserActivity: boolean }>;
    }>;

    expect(project.sessions.map(({ id, lastActivityAt }) => ({ id, lastActivityAt }))).toEqual([
      {
        id: emptySessionId,
        lastActivityAt: '2026-01-03T00:00:00.000Z',
      },
      {
        id: sessionWithMessageId,
        lastActivityAt: '2026-01-02T00:00:00.000Z',
      },
    ]);
    expect(project.sessions.map(({ id, hasUserActivity }) => ({ id, hasUserActivity }))).toEqual([
      { id: emptySessionId, hasUserActivity: false },
      { id: sessionWithMessageId, hasUserActivity: true },
    ]);
  });
  it('persists pins and bounded read markers without changing activity or restoring a workspace', async () => {
    const append = async (
      type: 'text' | 'status',
      data: object,
      parentEventId: number | null = null,
    ) =>
      (
        await db
          .insert(sessionEvents)
          .values({
            sessionId: sessionWithMessageId,
            type,
            data: JSON.stringify(data),
            parentEventId,
          })
          .returning()
      )[0].id;
    const get = async () =>
      (await app.inject({ method: 'GET', url: '/api/projects' }))
        .json()[0]
        .sessions.find((s: { id: string }) => s.id === sessionWithMessageId);
    const patch = (payload: object) =>
      app.inject({ method: 'PATCH', url: `/api/sessions/${sessionWithMessageId}`, payload });
    const assistant = await append('text', { role: 'provider', content: 'Done' });
    expect((await get()).latestActivityEventId).toBe(assistant);
    const completed = await append('status', { status: 'turn_end', stopReason: 'end_turn' });
    await append('text', { role: 'provider', content: 'Child transcript' }, assistant);
    expect(await get()).toMatchObject({
      latestActivityEventId: completed,
      sidebarActivity: 'completed',
      lastReadEventId: 0,
      selectedProvider: 'test-provider',
    });
    const reconcile = vi.spyOn(app.sessionManager, 'reconnectSession');
    const restore = vi.spyOn(app.sessionManager, 'ensureWorkspaceAvailable');
    await db
      .update(sessions)
      .set({ mode: 'worktree', updatedAt: new Date('2026-09-14T12:00:00.000Z') })
      .where(eq(sessions.id, sessionWithMessageId));
    expect((await patch({ pinned: true, lastReadEventId: completed })).statusCode).toBe(200);
    const pinned = await get();
    expect(pinned.pinnedAt).toBeTruthy();
    expect(pinned.lastReadEventId).toBe(completed);
    expect(pinned.lastActivityAt).toBe('2026-01-02T00:00:00.000Z');
    expect(pinned.updatedAt).toBe('2026-09-14T12:00:00.000Z');
    expect(reconcile).not.toHaveBeenCalled();
    expect(restore).not.toHaveBeenCalled();
    expect((await patch({ pinned: true, lastReadEventId: assistant })).statusCode).toBe(200);
    expect(await get()).toMatchObject({ pinnedAt: pinned.pinnedAt, lastReadEventId: completed });
    await append('status', { status: 'session_info_update', title: 'Renamed' });
    await append('text', { role: 'user', content: 'Next question' });
    await append('text', { role: 'thought', content: 'Internal reasoning' });
    await append('status', { status: 'runtime_error', diagnosticOnly: true });
    await db.insert(sessionEvents).values({
      sessionId: sessionWithMessageId,
      type: 'approval_request',
      data: JSON.stringify({ requiresApproval: false, status: 'approved' }),
    });
    expect((await get()).latestActivityEventId).toBe(completed);
    const failed = await append('status', { status: 'turn_end', stopReason: 'error' });
    expect(await get()).toMatchObject({
      sidebarActivity: 'failed',
      latestActivityEventId: failed,
      lastReadEventId: completed,
    });
    expect(
      (await patch({ pinned: false, lastReadEventId: Number.MAX_SAFE_INTEGER })).statusCode,
    ).toBe(200);
    expect(await get()).toMatchObject({ pinnedAt: null, lastReadEventId: failed });
    const next = await append('text', { role: 'provider', content: 'New result' });
    expect((await get()).latestActivityEventId).toBe(next);
    expect(next).toBeGreaterThan((await get()).lastReadEventId);
    expect((await patch({ lastReadEventId: -1 })).statusCode).toBe(400);
  });

  it('distinguishes pending input, approvals, active work and cancelled turns', async () => {
    await db
      .update(sessions)
      .set({ status: 'running' })
      .where(eq(sessions.id, sessionWithMessageId));
    const append = async (data: object) =>
      db
        .insert(sessionEvents)
        .values({ sessionId: sessionWithMessageId, type: 'status', data: JSON.stringify(data) });
    const activity = async () =>
      (await app.inject({ method: 'GET', url: '/api/projects' }))
        .json()[0]
        .sessions.find((s: { id: string }) => s.id === sessionWithMessageId).sidebarActivity;
    await append({ status: 'elicitation_requested', elicitation: { id: 'first' } });
    await append({ status: 'elicitation_requested', elicitation: { id: 'second' } });
    await append({ status: 'elicitation_responded', elicitationId: 'second' });
    expect(await activity()).toBe('input');
    await append({ status: 'elicitation_responded', elicitationId: 'first' });
    expect(await activity()).toBe('working');
    await db
      .update(sessions)
      .set({ status: 'needs_attention' })
      .where(eq(sessions.id, sessionWithMessageId));
    expect(await activity()).toBe('approval');
    await append({ status: 'elicitation_requested', elicitation: { id: 'stale' } });
    await append({ status: 'turn_end', stopReason: 'cancelled' });
    await db.update(sessions).set({ status: 'idle' }).where(eq(sessions.id, sessionWithMessageId));
    expect(await activity()).toBe('stopped');
    await append({ status: 'turn_started' });
    await db
      .update(sessions)
      .set({ status: 'running' })
      .where(eq(sessions.id, sessionWithMessageId));
    expect(await activity()).toBe('working');
    const [parent] = await db.select({ id: sessionEvents.id }).from(sessionEvents).limit(1);
    await db.insert(sessionEvents).values({
      sessionId: sessionWithMessageId,
      type: 'status',
      parentEventId: parent.id,
      data: JSON.stringify({
        status: 'elicitation_requested',
        elicitation: { id: 'child-input' },
      }),
    });
    expect(await activity()).toBe('input');
  });
});

const execFileAsync = promisify(execFile);
async function git(cwd: string, ...args: string[]) {
  return (await execFileAsync('git', args, { cwd })).stdout.trim();
}

describe('Draft workspace lifecycle through projects routes', () => {
  let app: FastifyInstance | undefined;
  let tempDir: string;
  let repoPath: string;
  let manager: WorkspaceManager;
  let db: ReturnType<typeof createDatabase>;
  let workspace: SessionWorkspace;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agentctl-home-workspace-'));
    repoPath = path.join(tempDir, 'repo');
    await fs.mkdir(repoPath);
    await git(repoPath, 'init');
    await git(repoPath, 'config', 'user.name', 'Test');
    await git(repoPath, 'config', 'user.email', 'test@example.com');
    await git(repoPath, 'config', 'commit.gpgSign', 'false');
    await fs.writeFile(path.join(repoPath, 'file.txt'), 'baseline');
    await git(repoPath, 'add', 'file.txt');
    await git(repoPath, 'commit', '-m', 'Initial');
    db = createDatabase(':memory:');
    manager = new WorkspaceManager(new GitMutex(), path.join(tempDir, 'worktrees'));
    workspace = new SessionWorkspace(db, manager, () => undefined);
    await db.insert(projects).values({
      id: '10000000-0000-4000-8000-000000000010',
      name: 'Home Project',
      path: repoPath,
      repoRoot: repoPath,
    });
  });

  afterEach(async () => {
    await app?.close();
    app = undefined;
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('lists stored sessions without restoring worktrees while browsing Home', async () => {
    const draft = await workspace.establish(
      '10000000-0000-4000-8000-000000000010',
      'missing-draft',
      {
        selectedProvider: 'test-provider',
        selectedModel: 'model-1',
      },
    );
    await manager.cleanup(repoPath, draft.worktreePath, draft.branch);
    app = await buildApp({ db, worktreeManager: manager, embedded: true });
    const response = await app.inject({ method: 'GET', url: '/api/projects' });
    expect(response.statusCode).toBe(200);
    const session = response.json()[0].sessions[0];
    expect(session.id).toBe(draft.sessionId);
    expect(session.hasUserActivity).toBe(false);
    expect(session.status).toBe('idle');
    await expect(fs.stat(draft.worktreePath)).rejects.toMatchObject({ code: 'ENOENT' });
  }, 15_000);

  it('registers a folder without creating a session or worktree', async () => {
    app = await buildApp({ db, worktreeManager: manager, embedded: true });
    const response = await app.inject({
      method: 'POST',
      url: '/api/projects/open',
      payload: { path: repoPath, startSession: false },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().session).toBeNull();
    expect(await db.select().from(sessions)).toHaveLength(0);
    expect(await git(repoPath, 'worktree', 'list', '--porcelain')).not.toContain('agentctl/');
  });

  it('keeps worktrees from every project sharing a repository during startup', async () => {
    await fs.mkdir(path.join(repoPath, 'subdir'));
    await fs.writeFile(path.join(repoPath, 'subdir', 'file.txt'), 'subdir');
    await git(repoPath, 'add', 'subdir');
    await git(repoPath, 'commit', '-m', 'Add subdirectory');
    await db.insert(projects).values({
      id: '10000000-0000-4000-8000-000000000011',
      name: 'Sub Project',
      path: path.join(repoPath, 'subdir'),
      repoRoot: repoPath,
      subdir: 'subdir',
    });
    const first = await workspace.establish('10000000-0000-4000-8000-000000000010', 'first', {
      selectedProvider: 'test',
      selectedModel: 'default',
    });
    const second = await workspace.establish('10000000-0000-4000-8000-000000000011', 'second', {
      selectedProvider: 'test',
      selectedModel: 'default',
    });
    const foreign = await manager.create(repoPath, 'foreign-database', 'foreign', 'HEAD');
    await fs.writeFile(path.join(first.worktreePath, 'unsaved.txt'), 'first unsaved');
    await fs.writeFile(path.join(second.worktreePath, 'unsaved.txt'), 'second unsaved');
    await fs.writeFile(path.join(foreign.path, 'unsaved.txt'), 'foreign unsaved');

    app = await buildApp({ db, worktreeManager: manager, embedded: true });
    await app.ready();
    expect(await fs.readFile(path.join(first.worktreePath, 'unsaved.txt'), 'utf8')).toBe(
      'first unsaved',
    );
    expect(await fs.readFile(path.join(second.worktreePath, 'unsaved.txt'), 'utf8')).toBe(
      'second unsaved',
    );
    expect(await fs.readFile(path.join(foreign.path, 'unsaved.txt'), 'utf8')).toBe(
      'foreign unsaved',
    );
  }, 15_000);
});
