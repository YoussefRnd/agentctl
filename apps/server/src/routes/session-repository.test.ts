import { createServerServices } from '../composition/server-services.js';
import Fastify, { type FastifyInstance } from 'fastify';
import { initServer } from '@ts-rest/fastify';
import { createDatabase, projects, sessions } from '@agentctl/core/db';
import { SnapshotService, GitRepositoryBackend } from '@agentctl/core/git';
import { RepositoryService, DirectoryBackend } from '@agentctl/core/repository';
import { repositoryContract, sessionGitContract } from '@agentctl/shared';
import { eq } from 'drizzle-orm';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createSessionRepositoryRouter } from '../plugins/ts-rest/session-repository.router.js';
import { createSessionGitRouter } from '../plugins/ts-rest/session-git.router.js';
import { AppError } from '../errors/app-error.js';

const exec = promisify(execFile);
const projectId = '11111111-1111-4111-8111-111111111111';
const sessionId = '22222222-2222-4222-8222-222222222222';
let directory: string;
let app: FastifyInstance;
let db: ReturnType<typeof createDatabase>;
const git = async (cwd: string, ...args: string[]) =>
  (await exec('git', args, { cwd })).stdout.trim();

beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'agentctl-session-repository-'));
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
  const snapshots = new SnapshotService(path.join(directory, '.git', 'test-snapshots'));
  const repositories = new RepositoryService([
    new GitRepositoryBackend(snapshots),
    new DirectoryBackend(),
  ]);
  app = Fastify();
  app.decorate('db', db);
  app.decorate('sessionManager', {
    getRepositoryService: () => repositories,
  } as unknown as FastifyInstance['sessionManager']);
  app.decorate('sessionService', {
    getSnapshotService: () => snapshots,
  } as unknown as FastifyInstance['sessionService']);
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof AppError)
      return reply.code(error.statusCode).send({ message: error.message });
    return reply.send(error);
  });
  app.decorate('services', createServerServices(app));
  const server = initServer();
  await app.register(
    server.plugin(
      server.router(
        { ...repositoryContract, getSessionReview: sessionGitContract.getSessionReview },
        {
          ...createSessionRepositoryRouter(app),
          getSessionReview: createSessionGitRouter(app).getSessionReview,
        },
      ),
    ),
  );
});

afterEach(async () => {
  vi.restoreAllMocks();
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

it('exposes ordinary folder capabilities without claiming a clean versioned workspace', async () => {
  await fs.writeFile(path.join(directory, 'local.txt'), 'ordinary file');
  const info = await app.inject(`/api/sessions/${sessionId}/repository`);
  expect(info.statusCode, info.body).toBe(200);
  expect(info.json()).toMatchObject({
    backendId: 'directory',
    capabilities: { review: false, checkpoints: false, comparisons: false, restore: false },
  });
  const review = await app.inject(`/api/sessions/${sessionId}/repository/review`);
  expect(review.statusCode, review.body).toBe(200);
  expect(review.json()).toMatchObject({ files: [], repository: { backendId: 'directory' } });
  expect(review.json().capture).toBeUndefined();
  expect(await fs.readdir(directory)).toEqual(['local.txt']);
});

it('serves immutable file details through the repository API while retaining the legacy Git API', async () => {
  await initializeRepository();
  const head = await git(directory, 'rev-parse', 'HEAD');
  await db.update(sessions).set({ baseCommit: head }).where(eq(sessions.id, sessionId));
  await fs.writeFile(path.join(directory, 'baseline.txt'), 'captured\n');
  const summary = await app.inject(
    `/api/sessions/${sessionId}/repository/review?includeDiffs=false&scope=working`,
  );
  expect(summary.statusCode, summary.body).toBe(200);
  const { capture } = summary.json();
  expect(summary.json().repository.backendId).toBe('git');
  expect(summary.json().files[0].diff).toBe('');
  expect(capture.current).toMatch(/^revision:v1:/);
  expect(capture.currentTree).toBeUndefined();
  await fs.writeFile(path.join(directory, 'baseline.txt'), 'later\n');
  const detail = await app.inject(
    `/api/sessions/${sessionId}/repository/review?${new URLSearchParams({
      filePath: 'baseline.txt',
      fromRevision: capture.working,
      toRevision: capture.current,
    })}`,
  );
  expect(detail.statusCode, detail.body).toBe(200);
  expect(detail.json().files[0].diff).toContain('+captured');
  expect(detail.json().files[0].diff).not.toContain('later');
  const legacy = await app.inject(`/api/sessions/${sessionId}/review?includeDiffs=false`);
  expect(legacy.statusCode, legacy.body).toBe(200);
  expect(legacy.json().capture.currentTree).toMatch(/^[a-f0-9]{40}$/);
  const malformed = await app.inject(
    `/api/sessions/${sessionId}/repository/review?${new URLSearchParams({
      filePath: 'baseline.txt',
      fromRevision: 'not-a-reference',
      toRevision: capture.current,
    })}`,
  );
  expect(malformed.statusCode).toBe(400);
  const incomplete = await app.inject(
    `/api/sessions/${sessionId}/repository/review?fromRevision=revision:one`,
  );
  expect(incomplete.statusCode).toBe(400);
  const missing = await app.inject('/api/sessions/33333333-3333-4333-8333-333333333333/repository');
  expect(missing.statusCode).toBe(404);
});

it('routes review through the selected backend without assuming Git revision syntax', async () => {
  const repositories = new RepositoryService([
    {
      id: 'example-vcs',
      open: async (workspacePath) => ({
        identity: {
          repositoryId: 'repo',
          workspaceId: 'workspace',
          workspacePath,
          rootPath: workspacePath,
          scope: '',
        },
        resolveRevision: async (selector) => `version:${selector}`,
        review: async () => ({
          files: [{ path: 'file.txt', state: 'modified', diff: '' }],
          capture: { current: 'version:two', working: 'version:one', baseline: 'version:one' },
        }),
        compare: async () => ({ files: [], totalAdditions: 0, totalDeletions: 0 }),
        diff: async (from, to) => [
          { path: 'file.txt', state: 'modified', diff: `${from} -> ${to}` },
        ],
      }),
    },
  ]);
  vi.spyOn(app.sessionManager, 'getRepositoryService').mockReturnValue(repositories);
  const summary = await app.inject(`/api/sessions/${sessionId}/repository/review`);
  expect(summary.statusCode, summary.body).toBe(200);
  expect(summary.json().repository.backendId).toBe('example-vcs');
  const { capture } = summary.json();
  const detail = await app.inject(
    `/api/sessions/${sessionId}/repository/review?${new URLSearchParams({
      filePath: 'file.txt',
      fromRevision: capture.working,
      toRevision: capture.current,
    })}`,
  );
  expect(detail.statusCode, detail.body).toBe(200);
  expect(detail.json().files[0].diff).toBe('version:one -> version:two');
});
