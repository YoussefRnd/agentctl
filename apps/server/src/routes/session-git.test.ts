import { createServerServices } from '../composition/server-services.js';
import { AcpAgentDriver } from '@agentctl/core/acp';
import type { AgentSession } from '@agentctl/core';
import Fastify, { type FastifyInstance } from 'fastify';
import { initServer } from '@ts-rest/fastify';
import { createDatabase, projects, sessions, providers } from '@agentctl/core/db';
import { GitMutex, WorkspaceManager, SnapshotService, SessionWorkspace } from '@agentctl/core/git';
import { sessionsContract } from '@agentctl/shared';
import { eq } from 'drizzle-orm';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createSessionsRouter } from '../plugins/ts-rest/sessions.router.js';
import { SessionService } from '../services/session-service.js';
import { ProviderRegistry } from '@agentctl/core/providers';
import { AppError } from '../errors/app-error.js';

const exec = promisify(execFile);
const projectId = '11111111-1111-4111-8111-111111111111';
const sessionId = '22222222-2222-4222-8222-222222222222';
let directory: string;
let worktreeStorage: string;
let app: FastifyInstance;
let db: ReturnType<typeof createDatabase>;
let workspace: SessionWorkspace;
const git = async (cwd: string, ...args: string[]) =>
  (await exec('git', args, { cwd })).stdout.trim();

beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'agentctl-session-git-'));
  worktreeStorage = await fs.mkdtemp(path.join(os.tmpdir(), 'agentctl-session-worktrees-'));
  db = createDatabase(':memory:');
  db.insert(projects)
    .values({ id: projectId, name: 'Project', path: directory, repoRoot: null })
    .run();
  db.insert(sessions)
    .values({
      id: sessionId,
      projectId,
      mode: 'local',
      branch: 'main',
      worktreePath: directory,
      taskSlug: 'task',
      baseCommit: 'none',
      agent: 'agent',
      selectedProvider: 'agent',
    })
    .run();
  app = Fastify();
  app.decorate('db', db);
  app.decorate('providerRegistry', {
    getSettings: () => ({}),
    getProvider: () => ({
      isReady: true,
      toDiscovery: () => ({ enabled: true, customModels: [] }),
      features: {},
      resolveDefaultSelection: () => ({ selectedThinkingEffort: null }),
      getLaunchConfig: () => ({ command: 'agent', args: ['--acp'], env: {} }),
    }),
  } as unknown as ProviderRegistry);
  const manager = new WorkspaceManager(new GitMutex(), worktreeStorage);
  const snapshots = new SnapshotService(path.join(directory, '.git', 'test-snapshots'));
  workspace = new SessionWorkspace(
    db,
    manager,
    () => {},
    () => snapshots,
  );
  app.decorate('worktreeManager', manager);
  app.decorate('sessionManager', {
    getSnapshotService: () => snapshots,
    runWorkspaceCommand: (_id: string, _payload: unknown, execute: () => Promise<unknown>) =>
      execute(),
    undoDiscard: (id: string) => workspace.undoDiscard(id),
    getSession: () => undefined,
    stopSession: () => {},
    finalizeSession: (
      id: string,
      action: 'merge' | 'discard',
      commitMessage?: string,
      targetBranch?: string,
    ) =>
      workspace.finalize(id, action === 'merge' ? 'merged' : 'discarded', {
        commitMessage,
        baseBranch: targetBranch,
      }),
  } as unknown as FastifyInstance['sessionManager']);
  app.decorate(
    'sessionService',
    new SessionService(db, app.sessionManager, manager, {} as ProviderRegistry, app.log),
  );
  app.decorate('eventBus', { publishState: vi.fn() } as unknown as FastifyInstance['eventBus']);
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof AppError)
      return reply.code(error.statusCode).send({ message: error.message });
    return reply.send(error);
  });
  app.decorate('services', createServerServices(app));
  const server = initServer();
  const routes = createSessionsRouter(app);
  await app.register(
    server.plugin(
      server.router(
        {
          stageAllFiles: sessionsContract.stageAllFiles,
          stageFile: sessionsContract.stageFile,
          commitChanges: sessionsContract.commitChanges,
          getGitStatus: sessionsContract.getGitStatus,
          generateGitDraft: sessionsContract.generateGitDraft,
          getSessionMergePreview: sessionsContract.getSessionMergePreview,
          mergeSession: sessionsContract.mergeSession,
          getSessionReview: sessionsContract.getSessionReview,
          fetchChanges: sessionsContract.fetchChanges,
          pullChanges: sessionsContract.pullChanges,
          createSessionBranch: sessionsContract.createSessionBranch,
        },
        {
          stageAllFiles: routes.stageAllFiles,
          stageFile: routes.stageFile,
          commitChanges: routes.commitChanges,
          getGitStatus: routes.getGitStatus,
          generateGitDraft: routes.generateGitDraft,
          getSessionMergePreview: routes.getSessionMergePreview,
          mergeSession: routes.mergeSession,
          getSessionReview: routes.getSessionReview,
          fetchChanges: routes.fetchChanges,
          pullChanges: routes.pullChanges,
          createSessionBranch: routes.createSessionBranch,
        },
      ),
    ),
  );
});
afterEach(async () => {
  vi.restoreAllMocks();
  await app.close();
  await fs.rm(directory, { recursive: true, force: true });
  await fs.rm(worktreeStorage, { recursive: true, force: true });
});

async function initializeRepository() {
  await git(directory, 'init', '-b', 'main');
  await git(directory, 'config', 'user.name', 'Test');
  await git(directory, 'config', 'user.email', 'test@example.com');
  await git(directory, 'config', 'commit.gpgSign', 'false');
  await fs.writeFile(path.join(directory, 'baseline.txt'), 'baseline');
  await git(directory, 'add', '.');
  await git(directory, 'commit', '-m', 'Baseline');
}

it('stages and commits when Git was initialized after the project was saved', async () => {
  await initializeRepository();
  await fs.writeFile(path.join(directory, 'change.txt'), 'new work');
  const stage = await app.inject({
    method: 'POST',
    url: `/api/sessions/${sessionId}/review/stage-all`,
    payload: {},
  });
  expect(stage.statusCode, stage.body).toBe(200);
  expect(await db.query.projects.findFirst({ where: eq(projects.id, projectId) })).toMatchObject({
    repoRoot: directory,
    subdir: '',
  });
  const commit = await app.inject({
    method: 'POST',
    url: `/api/sessions/${sessionId}/review/commit`,
    payload: { message: 'New work' },
  });
  expect(commit.statusCode, commit.body).toBe(200);
  expect(await git(directory, 'log', '-1', '--format=%s')).toBe('New work');
  expect(await git(directory, 'status', '--porcelain')).toBe('');
});

it('discovers a nested project root and commits inside its isolated session worktree', async () => {
  await initializeRepository();
  const subdir = 'packages/app';
  await fs.mkdir(path.join(directory, subdir), { recursive: true });
  await fs.writeFile(path.join(directory, subdir, 'app.txt'), 'original');
  await git(directory, 'add', '.');
  await git(directory, 'commit', '-m', 'App');
  const worktree = path.join(directory, 'session-worktree');
  await git(directory, 'worktree', 'add', '-b', 'feature', worktree);
  db.update(projects)
    .set({ path: path.join(directory, subdir) })
    .where(eq(projects.id, projectId))
    .run();
  db.update(sessions)
    .set({ mode: 'worktree', branch: 'feature', worktreePath: path.join(worktree, subdir) })
    .where(eq(sessions.id, sessionId))
    .run();
  await fs.writeFile(path.join(worktree, subdir, 'app.txt'), 'updated');
  const stage = await app.inject({
    method: 'POST',
    url: `/api/sessions/${sessionId}/review/stage`,
    payload: { filePath: 'app.txt' },
  });
  expect(stage.statusCode, stage.body).toBe(200);
  expect(await db.query.projects.findFirst({ where: eq(projects.id, projectId) })).toMatchObject({
    repoRoot: directory,
    subdir,
  });
  const commit = await app.inject({
    method: 'POST',
    url: `/api/sessions/${sessionId}/review/commit`,
    payload: { message: 'Worktree edit' },
  });
  expect(commit.statusCode, commit.body).toBe(200);
  expect(await git(worktree, 'log', '-1', '--format=%s')).toBe('Worktree edit');
  expect(await git(directory, 'log', '-1', '--format=%s')).toBe('App');
  expect(await fs.readFile(path.join(directory, subdir, 'app.txt'), 'utf8')).toBe('original');
});

it('refreshes Git status when an existing repository has missing saved metadata', async () => {
  await initializeRepository();
  const response = await app.inject(`/api/sessions/${sessionId}/git/status`);
  expect(response.statusCode, response.body).toBe(200);
  expect(response.json()).toMatchObject({ isRepo: true, branch: 'main' });
  expect(await db.query.projects.findFirst({ where: eq(projects.id, projectId) })).toMatchObject({
    repoRoot: directory,
  });
});

it('reports the unborn branch even when the session has a stale HEAD label', async () => {
  await git(directory, 'init', '-b', 'master');
  db.update(sessions).set({ branch: 'HEAD' }).where(eq(sessions.id, sessionId)).run();
  const response = await app.inject(`/api/sessions/${sessionId}/git/status`);
  expect(response.statusCode, response.body).toBe(200);
  expect(response.json()).toMatchObject({ isRepo: true, branch: 'master' });
});

it('reuses an isolated checkout across branch switches and removes it on teardown', async () => {
  await initializeRepository();
  await fs.writeFile(path.join(directory, '.gitignore'), 'ignored.txt\n');
  await git(directory, 'add', '.gitignore');
  await git(directory, 'commit', '-m', 'Ignore local workspace file');
  await git(directory, 'branch', 'first');
  await git(directory, 'branch', 'second');
  const worktree = path.join(directory, 'session-worktree');
  await git(directory, 'worktree', 'add', worktree, 'first');
  await fs.writeFile(path.join(worktree, 'ignored.txt'), 'Retain workspace configuration');
  db.update(sessions)
    .set({ mode: 'worktree', branch: 'first', worktreePath: worktree })
    .where(eq(sessions.id, sessionId))
    .run();
  for (const branch of ['second', 'first']) {
    const result = await app.sessionService.checkoutBranch(sessionId, branch);
    expect(result.worktreePath).toBe(worktree);
    expect(await git(worktree, 'symbolic-ref', '--short', 'HEAD')).toBe(branch);
    expect(await fs.readFile(path.join(worktree, 'ignored.txt'), 'utf8')).toBe(
      'Retain workspace configuration',
    );
    expect(
      (await git(directory, 'worktree', 'list', '--porcelain')).match(/^worktree /gm),
    ).toHaveLength(2);
    expect(await git(directory, 'symbolic-ref', '--short', 'HEAD')).toBe('main');
  }
  await workspace.teardown(sessionId);
  expect(await fs.stat(worktree).catch(() => null)).toBeNull();
  expect(
    (await git(directory, 'worktree', 'list', '--porcelain')).match(/^worktree /gm),
  ).toHaveLength(1);
});

it('reports seven untracked files and creates their first commit through the API', async () => {
  await git(directory, 'init', '-b', 'master');
  await git(directory, 'config', 'user.name', 'Test');
  await git(directory, 'config', 'user.email', 'test@example.com');
  await git(directory, 'config', 'commit.gpgSign', 'false');
  for (let i = 0; i < 7; i++)
    await fs.writeFile(path.join(directory, `file-${i}.txt`), 'one\ntwo\n');
  const summary = await app.inject(`/api/sessions/${sessionId}/review?includeDiffs=false`);
  expect(summary.statusCode, summary.body).toBe(200);
  const files = summary.json().files;
  expect(files).toHaveLength(7);
  expect(files.every((file: { hasUnstagedChanges: boolean }) => file.hasUnstagedChanges)).toBe(
    true,
  );
  expect(files.reduce((sum: number, file: { additions: number }) => sum + file.additions, 0)).toBe(
    14,
  );
  const commit = await app.inject({
    method: 'POST',
    url: `/api/sessions/${sessionId}/review/commit`,
    payload: { message: 'Add project files', includeUnstaged: true },
  });
  expect(commit.statusCode, commit.body).toBe(200);
  expect((await git(directory, 'ls-tree', '--name-only', 'HEAD')).split('\n')).toHaveLength(7);
  expect(await git(directory, 'status', '--porcelain')).toBe('');
});

it('reports a non-Git folder clearly without initializing a repository or changing files', async () => {
  await fs.writeFile(path.join(directory, 'file.txt'), 'keep me');
  const status = await app.inject(`/api/sessions/${sessionId}/git/status`);
  expect(status.statusCode).toBe(200);
  expect(status.json()).toMatchObject({ isRepo: false });
  const commit = await app.inject({
    method: 'POST',
    url: `/api/sessions/${sessionId}/review/commit`,
    payload: { message: 'Commit' },
  });
  expect(commit.statusCode).toBe(400);
  expect(commit.json()).toMatchObject({ message: 'Project is not a Git repository' });
  expect(await fs.readdir(directory)).toEqual(['file.txt']);
});

it('creates a branch through the API while keeping local changes', async () => {
  await initializeRepository();
  await fs.writeFile(path.join(directory, 'baseline.txt'), 'keep edits');
  const result = await app.inject({
    method: 'POST',
    url: `/api/sessions/${sessionId}/git/branches`,
    payload: { name: 'feature/new' },
  });
  expect(result.statusCode, result.body).toBe(200);
  expect(await git(directory, 'branch', '--show-current')).toBe('feature/new');
  expect(await fs.readFile(path.join(directory, 'baseline.txt'), 'utf8')).toBe('keep edits');
});
it('returns summaries and an individual working diff for a project opened before Git initialization', async () => {
  await initializeRepository();
  await fs.writeFile(path.join(directory, 'baseline.txt'), 'changed');
  const summary = await app.inject({
    method: 'GET',
    url: `/api/sessions/${sessionId}/review?includeDiffs=false`,
  });
  expect(summary.statusCode, summary.body).toBe(200);
  expect(summary.json().files[0]).toMatchObject({
    path: 'baseline.txt',
    state: 'modified',
    diff: '',
    hasUnstagedChanges: true,
  });
  const detail = await app.inject({
    method: 'GET',
    url: `/api/sessions/${sessionId}/review?filePath=baseline.txt&scope=working`,
  });
  expect(detail.statusCode, detail.body).toBe(200);
  expect(detail.json().files[0].diff).toContain('+changed');
});
it('fetches through the API and reports remote freshness', async () => {
  await initializeRepository();
  const remote = path.join(directory, 'remote.git');
  await git(directory, 'init', '--bare', remote);
  await git(directory, 'remote', 'add', 'origin', remote);
  await git(directory, 'push', '-u', 'origin', 'main');
  const fetched = await app.inject({
    method: 'POST',
    url: `/api/sessions/${sessionId}/git/fetch`,
    payload: {},
  });
  expect(fetched.statusCode, fetched.body).toBe(200);
  const status = await app.inject({ method: 'GET', url: `/api/sessions/${sessionId}/git/status` });
  expect(status.json().lastFetchedAt).toEqual(expect.any(String));
});

it('expands only the selected immutable capture without rescanning the workspace', async () => {
  await initializeRepository();
  await fs.writeFile(path.join(directory, 'change.txt'), 'captured content\n');
  const snapshots = app.sessionService.getSnapshotService();
  const summary = await app.inject({
    method: 'GET',
    url: `/api/sessions/${sessionId}/review?includeDiffs=false&scope=working`,
  });
  expect(summary.statusCode, summary.body).toBe(200);
  const { capture, files } = summary.json();
  expect(files.find((file: { path: string }) => file.path === 'change.txt').additions).toBe(1);
  const rescan = vi.spyOn(snapshots, 'getReview');
  await fs.writeFile(path.join(directory, 'change.txt'), 'newer content\n');
  const detail = await app.inject({
    method: 'GET',
    url: `/api/sessions/${sessionId}/review?${new URLSearchParams({ filePath: 'change.txt', fromHash: capture.workingTree, toHash: capture.currentTree })}`,
  });
  expect(detail.statusCode, detail.body).toBe(200);
  expect(detail.json().files).toHaveLength(1);
  expect(detail.json().files[0].diff).toContain('+captured content');
  expect(detail.json().files[0].diff).not.toContain('newer content');
  expect(rescan).not.toHaveBeenCalled();
});

it('rejects incomplete capture hashes before running Git', async () => {
  const response = await app.inject({
    method: 'GET',
    url: `/api/sessions/${sessionId}/review?fromHash=${'a'.repeat(40)}&filePath=file.txt`,
  });
  expect(response.statusCode).toBe(400);
});

it.each([
  ['idle', 200],
  ['error', 200],
  ['running', 400],
  ['needs_attention', 400],
  ['merged', 400],
  ['discarded', 400],
  ['archived', 400],
] as const)(
  'enforces the same Git eligibility for staging and branch creation in %s sessions',
  async (status, expected) => {
    await initializeRepository();
    await fs.writeFile(path.join(directory, 'change.txt'), 'change\n');
    await db.update(sessions).set({ status }).where(eq(sessions.id, sessionId));
    const stage = await app.inject({
      method: 'POST',
      url: `/api/sessions/${sessionId}/review/stage-all`,
      payload: {},
    });
    expect(stage.statusCode, stage.body).toBe(expected);
    const branch = await app.inject({
      method: 'POST',
      url: `/api/sessions/${sessionId}/git/branches`,
      payload: { name: 'next' },
    });
    expect(branch.statusCode, branch.body).toBe(expected);
    if (expected === 400) {
      expect(await git(directory, 'diff', '--cached', '--name-only')).toBe('');
      expect(await git(directory, 'branch', '--show-current')).toBe('main');
    } else {
      expect(await git(directory, 'diff', '--cached', '--name-only')).toBe('change.txt');
      expect(await git(directory, 'branch', '--show-current')).toBe('next');
    }
  },
);

it('merge readiness reports a dirty destination without changing either checkout', async () => {
  await git(directory, 'init', '-b', 'main');
  await git(directory, 'config', 'user.name', 'Test');
  await git(directory, 'config', 'user.email', 'test@example.com');
  await fs.writeFile(path.join(directory, 'file.txt'), 'base');
  await git(directory, 'add', '.');
  await git(directory, 'commit', '-m', 'Initial');
  const target = path.join(directory, 'source-worktree');
  await git(directory, 'worktree', 'add', '-b', 'feature', target);
  await db
    .update(sessions)
    .set({ mode: 'worktree', branch: 'feature', baseBranch: 'main', worktreePath: target })
    .where(eq(sessions.id, sessionId));
  await fs.writeFile(path.join(directory, 'file.txt'), 'dirty main');
  const before = await git(directory, 'rev-parse', 'main');
  const response = await app.inject({
    method: 'GET',
    url: `/api/sessions/${sessionId}/merge-preview`,
  });
  expect(response.statusCode).toBe(200);
  expect(response.json()).toMatchObject({
    baseBranch: 'main',
    targetPath: directory,
    uncommittedCount: 0,
    hasConflicts: false,
  });
  expect(response.json().blockedReason).toContain('Commit or stash');
  expect(await git(directory, 'rev-parse', 'main')).toBe(before);
  expect(await fs.readFile(path.join(directory, 'file.txt'), 'utf8')).toBe('dirty main');
  expect(await git(target, 'status', '--porcelain')).toBe('');
});

it('merge readiness refuses local sessions and active turns', async () => {
  await git(directory, 'init', '-b', 'main');
  const local = await app.inject({
    method: 'GET',
    url: `/api/sessions/${sessionId}/merge-preview`,
  });
  expect(local.statusCode).toBe(400);
  expect(local.json().message).toContain('Only worktree sessions');
  await db
    .update(sessions)
    .set({ mode: 'worktree', status: 'running' })
    .where(eq(sessions.id, sessionId));
  const active = await app.inject({
    method: 'GET',
    url: `/api/sessions/${sessionId}/merge-preview`,
  });
  expect(active.statusCode).toBe(400);
  expect(active.json().message).toContain('idle workspace');
});

it('previews and merges into the chosen branch while keeping main unchanged', async () => {
  await initializeRepository();
  await db.update(projects).set({ repoRoot: directory }).where(eq(projects.id, projectId));
  await git(directory, 'branch', 'develop');
  const source = path.join(worktreeStorage, 'source');
  await git(directory, 'worktree', 'add', '-b', 'feature', source);
  await fs.writeFile(path.join(source, 'feature.txt'), 'feature');
  await git(source, 'add', '.');
  await git(source, 'commit', '-m', 'Feature');
  await db
    .update(sessions)
    .set({ mode: 'worktree', branch: 'feature', baseBranch: 'main', worktreePath: source })
    .where(eq(sessions.id, sessionId));
  const main = await git(directory, 'rev-parse', 'main');
  const preview = await app.inject({
    method: 'GET',
    url: `/api/sessions/${sessionId}/merge-preview?targetBranch=develop`,
  });
  expect(preview.statusCode, preview.body).toBe(200);
  expect(preview.json()).toMatchObject({
    baseBranch: 'develop',
    targetPath: null,
    blockedReason: null,
  });
  const merged = await app.inject({
    method: 'POST',
    url: `/api/sessions/${sessionId}/merge`,
    payload: { commitMessage: 'Merge feature', targetBranch: 'develop' },
  });
  expect(merged.statusCode, merged.body).toBe(200);
  expect(await git(directory, 'rev-parse', 'main')).toBe(main);
  expect(await git(directory, 'show', 'develop:feature.txt')).toBe('feature');
  expect((await db.query.sessions.findFirst())?.baseBranch).toBe('develop');
  expect((await db.query.sessions.findFirst())?.status).toBe('merged');
  expect((await fs.stat(source)).isDirectory()).toBe(true);
});

it('remembers the chosen destination on conflict and rejects changing it mid-resolution', async () => {
  await initializeRepository();
  await db.update(projects).set({ repoRoot: directory }).where(eq(projects.id, projectId));
  await git(directory, 'branch', 'develop');
  const target = path.join(worktreeStorage, 'develop');
  const source = path.join(worktreeStorage, 'source');
  await git(directory, 'worktree', 'add', target, 'develop');
  await git(directory, 'worktree', 'add', '-b', 'feature', source);
  await fs.writeFile(path.join(source, 'baseline.txt'), 'feature version');
  await git(source, 'commit', '-am', 'Feature');
  await fs.writeFile(path.join(target, 'baseline.txt'), 'develop version');
  await git(target, 'commit', '-am', 'Develop');
  await db
    .update(sessions)
    .set({ mode: 'worktree', branch: 'feature', baseBranch: 'main', worktreePath: source })
    .where(eq(sessions.id, sessionId));
  const main = await git(directory, 'rev-parse', 'main');
  const conflict = await app.inject({
    method: 'POST',
    url: `/api/sessions/${sessionId}/merge`,
    payload: { targetBranch: 'develop' },
  });
  expect(conflict.statusCode, conflict.body).toBe(400);
  expect(conflict.json().message).toContain('Merge conflict');
  expect((await db.query.sessions.findFirst())?.baseBranch).toBe('develop');
  const changedPreview = await app.inject({
    method: 'GET',
    url: `/api/sessions/${sessionId}/merge-preview?targetBranch=main`,
  });
  expect(changedPreview.statusCode).toBe(400);
  expect(changedPreview.json().message).toContain('pending merge into develop');
  const changedMerge = await app.inject({
    method: 'POST',
    url: `/api/sessions/${sessionId}/merge`,
    payload: { targetBranch: 'main' },
  });
  expect(changedMerge.statusCode).toBe(400);
  expect(changedMerge.json().message).toContain('pending merge into develop');
  await fs.writeFile(path.join(source, 'baseline.txt'), 'resolved version');
  await git(source, 'add', 'baseline.txt');
  const retry = await app.inject({
    method: 'POST',
    url: `/api/sessions/${sessionId}/merge`,
    payload: { commitMessage: 'Resolved' },
  });
  expect(retry.statusCode, retry.body).toBe(200);
  expect(await fs.readFile(path.join(target, 'baseline.txt'), 'utf8')).toBe('resolved version');
  expect(await git(directory, 'rev-parse', 'main')).toBe(main);
});

it('rejects the source branch and missing destinations', async () => {
  await initializeRepository();
  await db.update(projects).set({ repoRoot: directory }).where(eq(projects.id, projectId));
  const source = path.join(worktreeStorage, 'source');
  await git(directory, 'worktree', 'add', '-b', 'feature', source);
  await db
    .update(sessions)
    .set({ mode: 'worktree', branch: 'feature', baseBranch: 'main', worktreePath: source })
    .where(eq(sessions.id, sessionId));
  for (const targetBranch of ['feature', 'missing']) {
    const response = await app.inject({
      method: 'POST',
      url: `/api/sessions/${sessionId}/merge`,
      payload: { targetBranch },
    });
    expect(response.statusCode, response.body).toBe(400);
    expect((await db.query.sessions.findFirst())?.baseBranch).toBe('main');
  }
  expect(await git(source, 'status', '--porcelain')).toBe('');
});

it.each([null, 'vendor-deep'])(
  'generates a draft with the provider effort %s without changing Git',
  async (effort) => {
    const getProvider = app.providerRegistry.getProvider.bind(app.providerRegistry);
    vi.spyOn(app.providerRegistry, 'getProvider').mockImplementation(
      (id) =>
        ({
          ...getProvider(id)!,
          resolveDefaultSelection: () => ({
            selectedModel: 'chosen-model',
            selectedThinkingEffort: effort,
          }),
        }) as never,
    );
    await initializeRepository();
    db.update(sessions)
      .set({ selectedModel: 'chosen-model' })
      .where(eq(sessions.id, sessionId))
      .run();
    await fs.writeFile(path.join(directory, 'new.txt'), 'new change');
    const beforeHead = await git(directory, 'rev-parse', 'HEAD');
    const beforeIndex = await git(directory, 'write-tree');
    const beforeStatus = await git(directory, 'status', '--porcelain');
    const close = vi.fn(async () => {});
    const start = vi
      .spyOn(AcpAgentDriver.prototype, 'startSession')
      .mockImplementation(async (_command, _args, options, callbacks) => {
        expect(options.cwd).not.toBe(directory);
        expect(options.selectedModel).toBe('chosen-model');
        expect(options.selectedThinkingEffort).toBe(effort);
        expect(options.intent).toEqual({ kind: 'new' });
        return {
          close,
          prompt: async (prompt: string) => {
            expect(prompt).toContain('new change');
            await callbacks.onUpdate({
              type: 'text',
              text: '{"subject":"feat: add change","body":""}',
            });
            return { stopReason: 'end_turn' };
          },
        } as unknown as AgentSession;
      });
    const response = await app.inject({
      method: 'POST',
      url: `/api/sessions/${sessionId}/git/generate-draft`,
      payload: { kind: 'commit', includeUnstaged: true },
    });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toEqual({ title: 'feat: add change', body: '' });
    expect(start).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
    expect(await git(directory, 'rev-parse', 'HEAD')).toBe(beforeHead);
    expect(await git(directory, 'write-tree')).toBe(beforeIndex);
    expect(await git(directory, 'status', '--porcelain')).toBe(beforeStatus);
  },
);
it('rejects a stale generation when the selected files change', async () => {
  await initializeRepository();
  await fs.writeFile(path.join(directory, 'new.txt'), 'original change');
  vi.spyOn(AcpAgentDriver.prototype, 'startSession').mockImplementation(
    async (_command, _args, _options, callbacks) =>
      ({
        close: async () => {},
        prompt: async () => {
          await fs.writeFile(path.join(directory, 'new.txt'), 'different change');
          await callbacks.onUpdate({
            type: 'text',
            text: '{"subject":"feat: old change","body":""}',
          });
          return { stopReason: 'end_turn' };
        },
      }) as unknown as AgentSession,
  );
  const response = await app.inject({
    method: 'POST',
    url: `/api/sessions/${sessionId}/git/generate-draft`,
    payload: { kind: 'commit', includeUnstaged: true },
  });
  expect(response.statusCode).toBe(400);
  expect(response.json().message).toContain('changed while generating');
  expect(await fs.readFile(path.join(directory, 'new.txt'), 'utf8')).toBe('different change');
});
it('blocks overlapping generations and releases the guard after completion', async () => {
  await initializeRepository();
  await fs.writeFile(path.join(directory, 'new.txt'), 'change');
  let started!: () => void;
  let finish!: () => void;
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    finish = resolve;
  });
  vi.spyOn(AcpAgentDriver.prototype, 'startSession').mockImplementation(
    async (_command, _args, _options, callbacks) =>
      ({
        close: async () => {},
        prompt: async () => {
          started();
          await gate;
          await callbacks.onUpdate({ type: 'text', text: '{"subject":"feat: change","body":""}' });
          return { stopReason: 'end_turn' };
        },
      }) as unknown as AgentSession,
  );
  const request = {
    method: 'POST' as const,
    url: `/api/sessions/${sessionId}/git/generate-draft`,
    payload: { kind: 'commit', includeUnstaged: true },
  };
  const first = app.inject(request).then((response) => response);
  await ready;
  const second = await app.inject(request);
  expect(second.statusCode).toBe(400);
  expect(second.json().message).toContain('already being generated');
  finish();
  expect((await first).statusCode).toBe(200);
  expect((await app.inject(request)).statusCode).toBe(200);
});

it.each(['commit', 'merge', 'pr'] as const)(
  'uses the dedicated provider profile and model for %s drafts without changing the chat selection',
  async (kind) => {
    await initializeRepository();
    await git(directory, 'checkout', '-b', 'feature');
    await fs.writeFile(path.join(directory, 'change.txt'), 'change for generation');
    if (kind === 'pr') {
      await git(directory, 'add', '.');
      await git(directory, 'commit', '-m', 'Change');
    }
    db.insert(providers)
      .values({
        id: 'writer',
        name: 'Writer',
        command: 'writer-acp',
        launchArgs: '["--stdio"]',
        installState: 'system_available',
        authState: 'not_required',
        connectionState: 'ready',
      })
      .run();
    db.insert(providers)
      .values({
        id: 'writer-profile',
        registryAgentId: 'writer',
        name: 'Writer profile',
        command: 'ignored-profile-command',
        authState: 'not_required',
        connectionState: 'ready',
        configOptions: JSON.stringify([
          {
            id: 'model',
            name: 'Model',
            currentValue: 'fast',
            options: [{ value: 'fast', name: 'Fast' }],
          },
        ]),
        customEnv: JSON.stringify({ PROFILE_ENV: 'writer-account' }),
      })
      .run();
    const registry = new ProviderRegistry(db);
    app.providerRegistry = registry;
    registry.updateSetting(
      'gitTextGeneration',
      JSON.stringify({ providerId: 'writer-profile', modelId: 'fast' }),
    );
    const original = await db.query.sessions.findFirst({ where: eq(sessions.id, sessionId) });
    vi.spyOn(AcpAgentDriver.prototype, 'startSession').mockImplementation(
      async (command, _args, options, callbacks) => {
        expect(command).toBe('writer-acp');
        expect(options.providerId).toBe('writer-profile');
        expect(options.selectedModel).toBe('fast');
        expect(options.env?.PROFILE_ENV).toBe('writer-account');
        return {
          close: async () => {},
          prompt: async () => {
            await callbacks.onUpdate({
              type: 'text',
              text:
                kind === 'pr'
                  ? '{"title":"Improve work","body":"## Testing\\nNot run"}'
                  : '{"subject":"Improve work","body":""}',
            });
            return { stopReason: 'end_turn' };
          },
        } as unknown as AgentSession;
      },
    );
    const response = await app.inject({
      method: 'POST',
      url: `/api/sessions/${sessionId}/git/generate-draft`,
      payload: kind === 'commit' ? { kind, includeUnstaged: true } : { kind, targetBranch: 'main' },
    });
    expect(response.statusCode, response.body).toBe(200);
    const current = await db.query.sessions.findFirst({ where: eq(sessions.id, sessionId) });
    expect(current?.selectedProvider).toBe(original?.selectedProvider);
    expect(current?.selectedModel).toBe(original?.selectedModel);
  },
);
it('does not launch a fallback provider when the generation override is unavailable', async () => {
  await initializeRepository();
  await fs.writeFile(path.join(directory, 'new.txt'), 'change');
  vi.spyOn(app.providerRegistry, 'getSettings').mockReturnValue({
    gitTextGeneration: JSON.stringify({ providerId: 'deleted', modelId: 'fast' }),
  });
  vi.spyOn(app.providerRegistry, 'getProvider').mockReturnValue(undefined);
  const start = vi.spyOn(AcpAgentDriver.prototype, 'startSession');
  const response = await app.inject({
    method: 'POST',
    url: `/api/sessions/${sessionId}/git/generate-draft`,
    payload: { kind: 'commit', includeUnstaged: true },
  });
  expect(response.statusCode).toBe(400);
  expect(response.json().message).toContain('provider is unavailable');
  expect(start).not.toHaveBeenCalled();
});

it('publishes partial index changes after a failed commit and runs it in the session lane', async () => {
  await initializeRepository();
  await fs.writeFile(path.join(directory, 'new.txt'), 'keep staged after hook failure');
  await fs.writeFile(path.join(directory, '.git/hooks/pre-commit'), '#!/bin/sh\nexit 1\n', {
    mode: 0o755,
  });
  const lane = vi.spyOn(app.sessionManager, 'runWorkspaceCommand');
  const response = await app.inject({
    method: 'POST',
    url: `/api/sessions/${sessionId}/review/commit`,
    payload: { message: 'Blocked commit', includeUnstaged: true },
  });
  expect(response.statusCode).toBe(400);
  expect(await git(directory, 'diff', '--cached', '--name-only')).toBe('new.txt');
  expect(lane).toHaveBeenCalledWith(sessionId, { action: 'commit' }, expect.any(Function));
  expect(app.eventBus.publishState).toHaveBeenCalledWith(
    expect.objectContaining({ topics: ['projects', 'session', 'workspace'], sessionId }),
  );
});
it('refreshes remote state when pull fetches refs but refuses divergent local history', async () => {
  await initializeRepository();
  const remote = path.join(worktreeStorage, 'remote.git');
  const clone = path.join(worktreeStorage, 'clone');
  await git(directory, 'init', '--bare', remote);
  await git(directory, 'remote', 'add', 'origin', remote);
  await git(directory, 'push', '-u', 'origin', 'main');
  await git(directory, 'clone', '--branch', 'main', remote, clone);
  await git(clone, 'config', 'user.name', 'Test');
  await git(clone, 'config', 'user.email', 'test@example.com');
  await git(clone, 'config', 'commit.gpgSign', 'false');
  await fs.writeFile(path.join(clone, 'remote.txt'), 'remote commit');
  await git(clone, 'add', '.');
  await git(clone, 'commit', '-m', 'Remote history');
  await git(clone, 'push');
  await fs.writeFile(path.join(directory, 'local.txt'), 'local commit');
  await git(directory, 'add', '.');
  await git(directory, 'commit', '-m', 'Local history');
  const head = await git(directory, 'rev-parse', 'HEAD');
  const response = await app.inject({
    method: 'POST',
    url: `/api/sessions/${sessionId}/review/pull`,
  });
  expect(response.statusCode).toBe(400);
  expect(response.json().message).toContain('diverged');
  expect(await git(directory, 'rev-parse', 'HEAD')).toBe(head);
  expect(await git(directory, 'rev-list', '--left-right', '--count', 'HEAD...@{upstream}')).toBe(
    '1\t1',
  );
  expect(app.eventBus.publishState).toHaveBeenCalledWith(
    expect.objectContaining({ topics: ['projects', 'session', 'workspace'], sessionId }),
  );
});

it('checks workspace readiness inside the session lane before touching Git', async () => {
  await initializeRepository();
  await fs.writeFile(path.join(directory, 'pending.txt'), 'keep uncommitted');
  vi.spyOn(app.sessionManager, 'runWorkspaceCommand').mockImplementationOnce(
    async (_id, _payload, execute) => {
      // A state transition won the lane before this queued Git command.
      await db.update(sessions).set({ status: 'running' }).where(eq(sessions.id, sessionId));
      return execute();
    },
  );
  const response = await app.inject({
    method: 'POST',
    url: `/api/sessions/${sessionId}/review/commit`,
    payload: { message: 'Do not commit', includeUnstaged: true },
  });
  expect(response.statusCode).toBe(400);
  expect(await git(directory, 'diff', '--cached', '--name-only')).toBe('');
  expect(await fs.readFile(path.join(directory, 'pending.txt'), 'utf8')).toBe('keep uncommitted');
});
