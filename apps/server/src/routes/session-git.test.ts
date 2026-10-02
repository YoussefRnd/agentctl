import Fastify, { type FastifyInstance } from 'fastify';
import { initServer } from '@ts-rest/fastify';
import { createDatabase, projects, sessions } from '@agentctl/core/db';
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
import type { ProviderRegistry } from '@agentctl/core/providers';
import { AppError } from '../errors/app-error.js';

const exec = promisify(execFile);
const projectId = '11111111-1111-4111-8111-111111111111';
const sessionId = '22222222-2222-4222-8222-222222222222';
let directory: string;
let app: FastifyInstance;
let db: ReturnType<typeof createDatabase>;
let workspace: SessionWorkspace;
const git = async (cwd: string, ...args: string[]) =>
  (await exec('git', args, { cwd })).stdout.trim();

beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'agentctl-session-git-'));
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
  const manager = new WorkspaceManager(new GitMutex());
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
    undoDiscard: (id: string) => workspace.undoDiscard(id),
    getSession: () => undefined,
    stopSession: () => {},
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
          getSessionReview: sessionsContract.getSessionReview,
          fetchChanges: sessionsContract.fetchChanges,
          createSessionBranch: sessionsContract.createSessionBranch,
        },
        {
          stageAllFiles: routes.stageAllFiles,
          stageFile: routes.stageFile,
          commitChanges: routes.commitChanges,
          getGitStatus: routes.getGitStatus,
          getSessionReview: routes.getSessionReview,
          fetchChanges: routes.fetchChanges,
          createSessionBranch: routes.createSessionBranch,
        },
      ),
    ),
  );
});
afterEach(async () => {
  await app.close();
  await fs.rm(directory, { recursive: true, force: true });
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
