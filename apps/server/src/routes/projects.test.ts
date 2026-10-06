import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
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
  const projectId = '10000000-0000-4000-8000-000000000001';
  const sessionWithMessageId = '20000000-0000-4000-8000-000000000001';
  const emptySessionId = '20000000-0000-4000-8000-000000000002';

  beforeEach(async () => {
    const db = createDatabase(':memory:');

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
