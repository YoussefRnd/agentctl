import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import type { SessionManager } from '@agentctl/core/session';
import { ReviewVerificationService } from './review-verification-service.js';
import { AcpAgentDriver } from '@agentctl/core/acp';
import { createServerServices } from '../composition/server-services.js';
import Fastify, { type FastifyInstance } from 'fastify';
import { initServer } from '@ts-rest/fastify';
import { afterEach, beforeEach, expect, it, vi } from 'vite-plus/test';
import { mkdtemp, rm, writeFile, symlink } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import {
  createDatabase,
  projects,
  sessions,
  codeReviews,
  codeReviewFindings,
  reviewChecks,
} from '@agentctl/core/db';
import {
  createDefaultRepositoryService,
  type AgentDriver,
  type AgentSession,
  type AgentSessionCallbacks,
  type AgentSessionOptions,
} from '@agentctl/core';
import { SnapshotService } from '@agentctl/core/git';
import type { ProviderRegistry } from '@agentctl/core/providers';
import { EMPTY_AGENT_FEATURES, sessionsContract } from '@agentctl/shared';
import { CodeReviewService } from './code-review-service.js';
import { createCodeReviewRouter } from '../plugins/ts-rest/code-review.router.js';
import { AppError } from '../errors/app-error.js';

const projectId = '11111111-1111-4111-8111-111111111111';
const sessionId = '22222222-2222-4222-8222-222222222222';
const secondSession = '33333333-3333-4333-8333-333333333333';
const exec = promisify(execFile);
let directory: string;
let storage: string;
let db: ReturnType<typeof createDatabase>;
let service: CodeReviewService;
let app: FastifyInstance;
let callbacks: AgentSessionCallbacks;
const prompt = vi.fn();
const close = vi.fn(async () => {});
const startSession = vi.fn();
const provider = {
  isInstalled: true,
  isReady: true,
  id: 'custom-acp',
  features: EMPTY_AGENT_FEATURES,
  toDiscovery: () => ({ enabled: true, customModels: [], configOptions: [] }),
  resolveDefaultSelection: () => ({
    selectedModel: 'provider-default',
    selectedThinkingEffort: null,
  }),
  getLaunchConfig: vi.fn(() => ({
    command: 'custom-acp',
    args: ['--acp'],
    env: { API_TOKEN: 'secret-fixture-value' },
  })),
};
const providers = {
  getProvider: vi.fn(() => provider),
  ensureProviderReady: vi.fn(async () => provider),
};
const events = { publishState: vi.fn() };
const result = {
  summary: 'One issue. Tests were not run.',
  findings: [
    {
      severity: 'medium',
      path: 'example.ts',
      line: 1,
      title: 'Missing guard',
      body: 'Empty input reaches the new call and throws.',
    },
  ],
};
const git = async (...args: string[]) =>
  (await exec('git', args, { cwd: directory })).stdout.trim();
function createService(database = db) {
  return new CodeReviewService(
    database,
    createDefaultRepositoryService(new SnapshotService(path.join(storage, 'snapshots'))),
    providers as unknown as ProviderRegistry,
    { startSession } as unknown as AgentDriver,
    events,
  );
}
async function finished(id: string) {
  await vi.waitFor(
    () =>
      expect(db.select().from(codeReviews).where(eq(codeReviews.id, id)).get()?.status).not.toBe(
        'running',
      ),
    { timeout: 5000 },
  );
}
beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), 'agentctl-review-workspace-'));
  storage = await mkdtemp(path.join(os.tmpdir(), 'agentctl-review-storage-'));
  db = createDatabase(path.join(storage, 'review.sqlite'));
  await git('init', '-b', 'main');
  await git('config', 'user.name', 'Test');
  await git('config', 'user.email', 'test@example.com');
  await git('config', 'commit.gpgSign', 'false');
  await writeFile(path.join(directory, 'example.ts'), 'export const value = 1;\n');
  await git('add', '.');
  await git('commit', '-m', 'Initial');
  db.insert(projects)
    .values({ id: projectId, name: 'Fixture', path: directory, repoRoot: directory })
    .run();
  db.insert(sessions)
    .values({
      id: sessionId,
      projectId,
      worktreePath: directory,
      branch: 'main',
      taskSlug: 'task',
      title: 'Fix input handling',
      baseCommit: await git('rev-parse', 'HEAD'),
      agent: 'custom-acp',
      selectedProvider: 'custom-acp',
      selectedModel: 'session-model',
    })
    .run();
  await writeFile(path.join(directory, 'example.ts'), 'export const value = missingGuard();\n');
  prompt.mockImplementation(async () => {
    await callbacks.onUpdate({ type: 'text', text: JSON.stringify(result) });
    return { stopReason: 'end_turn' };
  });
  startSession.mockImplementation(
    async (
      _command: string,
      _args: string[],
      _options: AgentSessionOptions,
      cb: AgentSessionCallbacks,
    ) => {
      callbacks = cb;
      return { prompt, close } as unknown as AgentSession;
    },
  );
  providers.getProvider.mockReset().mockReturnValue(provider);
  providers.ensureProviderReady.mockReset().mockResolvedValue(provider);
  service = createService();
  app = Fastify();
  app.decorate('services', { codeReview: service } as FastifyInstance['services']);
  app.setErrorHandler((error, _request, reply) =>
    error instanceof AppError
      ? reply.code(error.statusCode).send({ message: error.message })
      : reply.send(error),
  );
  const server = initServer();
  const routes = createCodeReviewRouter(app);
  await app.register(
    server.plugin(
      server.router(
        {
          listReviewChecks: sessionsContract.listReviewChecks,
          getReviewCheck: sessionsContract.getReviewCheck,
          runReviewCheck: sessionsContract.runReviewCheck,
          cancelReviewCheck: sessionsContract.cancelReviewCheck,
          confirmReviewFindingEvidence: sessionsContract.confirmReviewFindingEvidence,
          getCodeReviewFile: sessionsContract.getCodeReviewFile,
          listCodeReviews: sessionsContract.listCodeReviews,
          startCodeReview: sessionsContract.startCodeReview,
          cancelCodeReview: sessionsContract.cancelCodeReview,
          resolveCodeReviewFinding: sessionsContract.resolveCodeReviewFinding,
        },
        routes,
      ),
    ),
  );
});
afterEach(async () => {
  await service.dispose();
  await app.close();
  await rm(directory, { recursive: true, force: true });
  await rm(storage, { recursive: true, force: true });
  vi.clearAllMocks();
});
it('persists findings and manual resolutions across reopening the database, without editing or staging files', async () => {
  const statusBefore = await git('status', '--porcelain');
  const response = await app.inject({
    method: 'POST',
    url: `/api/sessions/${sessionId}/code-reviews`,
    payload: { scope: 'working', providerId: 'another-acp', modelId: 'chosen-model' },
  });
  expect(response.statusCode, response.body).toBe(202);
  const { id } = response.json<{ id: string }>();
  await finished(id);
  const saved = (await service.list(sessionId)).runs[0]!;
  expect(saved).toMatchObject({
    id,
    status: 'completed',
    providerId: 'another-acp',
    modelId: 'chosen-model',
    freshness: 'current',
  });
  expect(saved.findings).toHaveLength(1);
  expect(providers.ensureProviderReady).toHaveBeenCalledWith('another-acp', { force: false });
  expect(startSession.mock.calls[0]![2]).toMatchObject({
    intent: { kind: 'new' },
    selectedModel: 'chosen-model',
    providerId: 'another-acp',
  });
  const finding = saved.findings[0]!;
  const invalid = await app.inject({
    method: 'PATCH',
    url: `/api/sessions/${sessionId}/code-reviews/${id}/findings/${finding.id}`,
    payload: { status: 'dismissed', resolution: '   ' },
  });
  expect(invalid.statusCode).toBe(400);
  const resolved = await app.inject({
    method: 'PATCH',
    url: `/api/sessions/${sessionId}/code-reviews/${id}/findings/${finding.id}`,
    payload: { status: 'dismissed', resolution: 'Caller already checks input.' },
  });
  expect(resolved.statusCode).toBe(200);
  await service.dispose();
  const reopened = createService(createDatabase(path.join(storage, 'review.sqlite')));
  try {
    expect((await reopened.list(sessionId)).runs[0]!.findings[0]).toMatchObject({
      id: finding.id,
      status: 'dismissed',
      resolution: 'Caller already checks input.',
    });
  } finally {
    await reopened.dispose();
  }
  expect(await git('status', '--porcelain')).toBe(statusBefore);
});
it('detects unstaged, staged, untracked and baseline changes, and keeps the original findings', async () => {
  const { id } = await service.start(sessionId, { scope: 'working' });
  await finished(id);
  expect((await service.list(sessionId)).runs[0]!.freshness).toBe('current');
  await writeFile(path.join(directory, 'example.ts'), 'export const value = fixed();\n');
  expect((await service.list(sessionId)).runs[0]!.freshness).toBe('outdated');
  await writeFile(path.join(directory, 'example.ts'), 'export const value = missingGuard();\n');
  await git('add', 'example.ts');
  expect((await service.list(sessionId)).runs[0]!.freshness).toBe('current'); // Staging alone does not change the reviewed content.
  await writeFile(path.join(directory, 'new.ts'), 'new file\n');
  expect((await service.list(sessionId)).runs[0]!.freshness).toBe('outdated');
  await rm(path.join(directory, 'new.ts'));
  await git('commit', '-m', 'Commit reviewed content');
  const saved = (await service.list(sessionId)).runs[0]!;
  expect(saved.freshness).toBe('outdated'); // Uncommitted comparison baseline changed.
  expect(saved.findings).toHaveLength(1);
});
it('marks a review outdated when files change while the ACP review is running', async () => {
  let finish!: () => void;
  prompt.mockImplementation(async () => {
    await new Promise<void>((resolve) => {
      finish = resolve;
    });
    await callbacks.onUpdate({ type: 'text', text: JSON.stringify(result) });
    return { stopReason: 'end_turn' };
  });
  const { id } = await service.start(sessionId, { scope: 'session' });
  await vi.waitFor(() => expect(prompt).toHaveBeenCalled());
  await writeFile(path.join(directory, 'example.ts'), 'export const value = fixed();\n');
  finish();
  await finished(id);
  expect((await service.list(sessionId)).runs[0]).toMatchObject({
    status: 'completed',
    freshness: 'outdated',
  });
});
it('preserves an earlier completed review when a later provider response fails validation', async () => {
  const first = await service.start(sessionId, { scope: 'working' });
  await finished(first.id);
  prompt.mockImplementation(async () => {
    await callbacks.onUpdate({
      type: 'text',
      text: '{"summary":"Everything is fine","findings":[{"bad":true}]}',
    });
    return { stopReason: 'end_turn' };
  });
  const second = await service.start(sessionId, { scope: 'working' });
  await finished(second.id);
  const { runs } = await service.list(sessionId);
  expect(runs.find((run) => run.id === first.id)?.findings).toHaveLength(1);
  expect(runs.find((run) => run.id === second.id)).toMatchObject({
    status: 'failed',
    findings: [],
  });
});
it('rejects duplicate starts, cancels without waiting for provider readiness, and never starts a cancelled ACP review', async () => {
  let finish!: (value: typeof provider) => void;
  providers.ensureProviderReady.mockImplementationOnce(
    async () =>
      await new Promise<typeof provider>((resolve) => {
        finish = resolve;
      }),
  );
  const { id } = await service.start(sessionId, { scope: 'working' });
  await expect(service.start(sessionId, { scope: 'working' })).rejects.toThrow('already running');
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'), { timeout: 5000 });
  service.cancel(sessionId, id);
  await service.dispose();
  expect((await service.list(sessionId)).runs[0]!.status).toBe('cancelled');
  finish(provider);
  await Promise.resolve();
  expect(startSession).not.toHaveBeenCalled();
});
it('recovers interrupted running reviews and keeps findings when the workspace is unavailable', async () => {
  providers.ensureProviderReady.mockImplementationOnce(
    async () => await new Promise<never>(() => {}),
  );
  const { id } = await service.start(sessionId, { scope: 'working' });
  const restarted = createService();
  try {
    expect((await restarted.list(sessionId)).runs[0]).toMatchObject({
      id,
      status: 'failed',
      error: expect.stringContaining('restart'),
    });
    await rm(directory, { recursive: true, force: true });
    expect((await restarted.list(sessionId)).runs[0]!.freshness).toBe('unknown');
  } finally {
    await restarted.dispose();
  }
});
it('enforces session ownership for findings and cancellation, and cascades deletion', async () => {
  const { id } = await service.start(sessionId, { scope: 'working' });
  await finished(id);
  const finding = db.select().from(codeReviewFindings).get()!;
  const patch = await app.inject({
    method: 'PATCH',
    url: `/api/sessions/${secondSession}/code-reviews/${id}/findings/${finding.id}`,
    payload: { status: 'fixed' },
  });
  expect(patch.statusCode).toBe(404);
  const cancel = await app.inject({
    method: 'POST',
    url: `/api/sessions/${secondSession}/code-reviews/${id}/cancel`,
    payload: {},
  });
  expect(cancel.statusCode).toBe(404);
  db.delete(sessions).where(eq(sessions.id, sessionId)).run();
  expect(db.select().from(codeReviews).all()).toEqual([]);
  expect(db.select().from(codeReviewFindings).all()).toEqual([]);
});
it('does not follow review-guide symlinks, and redacts provider errors', async () => {
  await writeFile(path.join(storage, 'secret.md'), 'SHOULD_NOT_BE_SENT');
  await symlink(path.join(storage, 'secret.md'), path.join(directory, 'REVIEW.md'));
  prompt.mockImplementation(async () => {
    throw new Error('API_TOKEN=secret-fixture-value');
  });
  const { id } = await service.start(sessionId, { scope: 'working' });
  await finished(id);
  expect(prompt.mock.calls[0]![0]).not.toContain('SHOULD_NOT_BE_SENT');
  expect((await service.list(sessionId)).runs[0]!.error).not.toContain('secret-fixture-value');
});
it('refuses active sessions and empty scopes without starting an agent', async () => {
  db.update(sessions).set({ status: 'running' }).where(eq(sessions.id, sessionId)).run();
  await expect(service.start(sessionId, { scope: 'working' })).rejects.toThrow('active turn');
  db.update(sessions).set({ status: 'idle' }).where(eq(sessions.id, sessionId)).run();
  await git('checkout', '--', 'example.ts');
  await expect(service.start(sessionId, { scope: 'working' })).rejects.toThrow('no changes');
  expect(startSession).not.toHaveBeenCalled();
});
it('paginates saved review history without losing findings or skipping equal timestamps', async () => {
  const { id } = await service.start(sessionId, { scope: 'working' });
  await finished(id);
  const source = db.select().from(codeReviews).where(eq(codeReviews.id, id)).get()!;
  for (let index = 1; index <= 25; index++)
    db.insert(codeReviews)
      .values({ ...source, id: `aaaaaaaa-aaaa-4aaa-8aaa-${String(index).padStart(12, '0')}` })
      .run();
  const first = await service.list(sessionId);
  expect(first.runs).toHaveLength(20);
  expect(first.nextCursor).not.toBeNull();
  const next = await service.list(sessionId, first.nextCursor!);
  expect(next.runs).toHaveLength(6);
  expect(next.nextCursor).toBeNull();
  expect(new Set([...first.runs, ...next.runs].map((run) => run.id)).size).toBe(26);
  expect([...first.runs, ...next.runs].find((run) => run.id === id)?.findings).toHaveLength(1);
});
it('keeps session reviews current after committing identical contents and detects session-baseline changes', async () => {
  const { id } = await service.start(sessionId, { scope: 'session' });
  await finished(id);
  await git('add', 'example.ts');
  await git('commit', '-m', 'Commit reviewed content');
  expect((await service.list(sessionId)).runs[0]!.freshness).toBe('current');
  db.update(sessions)
    .set({ baseCommit: await git('rev-parse', 'HEAD') })
    .where(eq(sessions.id, sessionId))
    .run();
  expect((await service.list(sessionId)).runs[0]!.freshness).toBe('outdated');
});
it('uses the session model by default and the provider default when explicitly selected', async () => {
  const first = await service.start(sessionId, { scope: 'working' });
  await finished(first.id);
  expect(startSession.mock.calls[0]![2].selectedModel).toBe('session-model');
  const second = await service.start(sessionId, { scope: 'working', providerId: 'custom-acp' });
  await finished(second.id);
  expect(startSession.mock.calls[1]![2].selectedModel).toBe('provider-default');
});
it('redacts profile secrets in installation/readiness failures before ACP starts', async () => {
  providers.ensureProviderReady.mockRejectedValueOnce(
    new Error('Preparation failed: secret-fixture-value'),
  );
  const { id } = await service.start(sessionId, { scope: 'working' });
  await finished(id);
  expect((await service.list(sessionId)).runs[0]!.error).not.toContain('secret-fixture-value');
  expect(startSession).not.toHaveBeenCalled();
});
it('composes an independent ACP driver so review cancellation cannot kill pooled coding sessions', async () => {
  const sharedStart = vi.fn();
  const independent = vi
    .spyOn(AcpAgentDriver, 'create')
    .mockReturnValue({ startSession } as unknown as AcpAgentDriver);
  const composed = Fastify();
  composed.decorate('db', db);
  composed.decorate('runtimeServices', {
    driver: { startSession: sharedStart },
  } as unknown as FastifyInstance['runtimeServices']);
  composed.decorate('providerRegistry', providers as unknown as ProviderRegistry);
  composed.decorate('sessionManager', {
    getRepositoryService: () =>
      createDefaultRepositoryService(new SnapshotService(path.join(storage, 'snapshots'))),
  } as unknown as FastifyInstance['sessionManager']);
  composed.decorate('eventBus', events as unknown as FastifyInstance['eventBus']);
  try {
    const services = createServerServices(composed);
    const { id } = await services.codeReview.start(sessionId, { scope: 'working' });
    await finished(id);
    expect(independent).toHaveBeenCalledWith(spawn, composed.log, undefined);
    expect(sharedStart).not.toHaveBeenCalled();
    expect(startSession).toHaveBeenCalledOnce();
    expect((await services.codeReview.list(sessionId)).runs[0]!.status).toBe('completed');
  } finally {
    await composed.close();
    independent.mockRestore();
  }
});
it('persists rich snapshot coverage and supplies callers, dependencies and tests without live-file drift', async () => {
  await writeFile(path.join(directory, 'rates.ts'), 'export function lookupRate() { return 2; }\n');
  await writeFile(
    path.join(directory, 'example.test.ts'),
    'import { value } from "./example";\nexpect(value).toBe(2);\n',
  );
  await writeFile(
    path.join(directory, 'checkout.ts'),
    'import { value } from "./example";\nexport const capturedCaller = "PINNED_CALLER" + value;\n',
  );
  await git('add', '.');
  await git('commit', '-m', 'Add callers and tests');
  db.update(sessions)
    .set({ baseCommit: await git('rev-parse', 'HEAD') })
    .where(eq(sessions.id, sessionId))
    .run();
  await writeFile(
    path.join(directory, 'example.ts'),
    'import { lookupRate } from "./rates";\nexport const value = lookupRate();\n',
  );
  const { id } = await service.start(sessionId, { scope: 'working' });
  await writeFile(path.join(directory, 'checkout.ts'), 'LIVE_CALLER_MUTATION');
  await finished(id);
  const saved = (await service.list(sessionId)).runs[0]!;
  expect(saved.status, saved.error ?? '').toBe('completed');
  expect(saved.context?.version).toBe(2);
  expect(saved.context?.files).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ path: 'rates.ts', role: 'dependency' }),
      expect.objectContaining({ path: 'example.test.ts', role: 'test' }),
      expect.objectContaining({ path: 'checkout.ts', role: 'reference' }),
    ]),
  );
  expect(prompt.mock.calls[0]![0]).toContain('PINNED_CALLER');
  expect(prompt.mock.calls[0]![0]).not.toContain('LIVE_CALLER_MUTATION');
  expect(JSON.stringify(saved.context)).not.toContain('PINNED_CALLER');
  expect(saved.freshness).toBe('outdated');
  const reopened = createService(createDatabase(path.join(storage, 'review.sqlite')));
  try {
    expect((await reopened.list(sessionId)).runs[0]!.context).toEqual(saved.context);
  } finally {
    await reopened.dispose();
  }
});
it('keeps legacy findings readable when no context report was stored', async () => {
  const { id } = await service.start(sessionId, { scope: 'working' });
  await finished(id);
  db.update(codeReviews).set({ context: null }).where(eq(codeReviews.id, id)).run();
  const saved = (await service.list(sessionId)).runs[0]!;
  expect(saved.context).toBeNull();
  expect(saved.findings).toHaveLength(1);
});

it('supplies saved execution evidence to a new review with a different ACP provider and saves its provenance', async () => {
  const source = await service.start(sessionId, { scope: 'working' });
  await finished(source.id);
  const sourceRow = db.select().from(codeReviews).where(eq(codeReviews.id, source.id)).get()!;
  const checkId = randomUUID();
  db.insert(reviewChecks)
    .values({
      id: checkId,
      reviewId: source.id,
      name: 'Regression',
      command: 'pnpm test example',
      status: 'failed',
      timeoutMs: 180000,
      cwd: directory,
      expectedRevision: sourceRow.toRevision,
      checkedRevision: sourceRow.toRevision,
      afterRevision: sourceRow.toRevision,
      revisionState: 'unchanged',
      exitCode: 1,
      stdout: 'SAVED_REGRESSION_FAILURE',
      startedAt: 10,
      finishedAt: 20,
    })
    .run();
  const repositories = createDefaultRepositoryService(
    new SnapshotService(path.join(storage, 'snapshots')),
  );
  const verification = new ReviewVerificationService(
    db,
    repositories,
    {} as Pick<SessionManager, 'runWorkspaceCommand'>,
    events,
  );
  await service.dispose();
  service = new CodeReviewService(
    db,
    repositories,
    providers as unknown as ProviderRegistry,
    { startSession } as unknown as AgentDriver,
    events,
    verification,
  );
  try {
    const repeated = await service.start(sessionId, {
      scope: 'working',
      providerId: 'another-acp',
      evidenceReviewId: source.id,
    });
    await finished(repeated.id);
    const saved = (await service.list(sessionId)).runs.find((run) => run.id === repeated.id)!;
    expect(saved).toMatchObject({ providerId: 'another-acp', evidenceCheckIds: [checkId] });
    expect(prompt.mock.calls.at(-1)![0]).toContain('SAVED_REGRESSION_FAILURE');
    expect(saved.findings[0]!.verification?.state).toBe('suspected');
    await writeFile(path.join(directory, 'example.ts'), 'export const value = changedAgain();\n');
    const changed = await service.start(sessionId, {
      scope: 'working',
      evidenceReviewId: source.id,
    });
    await finished(changed.id);
    expect(prompt.mock.calls.at(-1)![0]).not.toContain('SAVED_REGRESSION_FAILURE');
    expect(
      (await service.list(sessionId)).runs.find((run) => run.id === changed.id)!.evidenceCheckIds,
    ).toEqual([]);
  } finally {
    await verification.dispose();
  }
});
it('serves the exact saved patch after edits, database reopen, and workspace removal, with session and path ownership', async () => {
  const { id } = await service.start(sessionId, { scope: 'working' });
  await finished(id);
  const original = await service.file(sessionId, id, 'example.ts');
  expect(original.source).toBe('saved');
  expect(original.file?.diff).toContain('missingGuard');
  const listed = (await service.list(sessionId)).runs[0]!;
  expect(listed).not.toHaveProperty('capturedFiles');
  await writeFile(path.join(directory, 'example.ts'), 'LIVE_EDIT_MUST_NOT_APPEAR\n');
  const apiFile = await app.inject({
    method: 'GET',
    url: `/api/sessions/${sessionId}/code-reviews/${id}/file?path=example.ts`,
  });
  expect(apiFile.statusCode, apiFile.body).toBe(200);
  expect(apiFile.body).not.toContain('LIVE_EDIT');
  expect(
    (
      await app.inject({
        method: 'GET',
        url: `/api/sessions/${secondSession}/code-reviews/${id}/file?path=example.ts`,
      })
    ).statusCode,
  ).toBe(404);
  expect(
    (
      await app.inject({
        method: 'GET',
        url: `/api/sessions/${sessionId}/code-reviews/${id}/file?path=../private`,
      })
    ).statusCode,
  ).toBe(404);
  await service.dispose();
  await rm(directory, { recursive: true, force: true });
  service = createService(createDatabase(path.join(storage, 'review.sqlite')));
  expect(await service.file(sessionId, id, 'example.ts')).toEqual(original);
});
it('uses immutable source for legacy findings and reports missing source without substituting a live file', async () => {
  const { id } = await service.start(sessionId, { scope: 'working' });
  await finished(id);
  db.update(codeReviews).set({ capturedFiles: null }).where(eq(codeReviews.id, id)).run();
  await writeFile(path.join(directory, 'example.ts'), 'LIVE_ONLY_SOURCE\n');
  expect(await service.file(sessionId, id, 'example.ts')).toMatchObject({
    source: 'snapshot',
    file: { path: 'example.ts', diff: expect.stringContaining('missingGuard') },
  });
  await rm(directory, { recursive: true, force: true });
  expect(await service.file(sessionId, id, 'example.ts')).toEqual({
    file: null,
    source: 'unavailable',
  });
});
it('carries decisions across ACP providers and repeated reviews, links recurring findings, and never inherits their resolved state', async () => {
  const first = await service.start(sessionId, { scope: 'working' });
  await finished(first.id);
  const initial = (await service.list(sessionId)).runs[0]!.findings[0]!;
  service.resolve(sessionId, first.id, initial.id, {
    status: 'dismissed',
    resolution: 'The caller already guards empty input.',
  });
  const second = await service.start(sessionId, { scope: 'working', providerId: 'another-acp' });
  await finished(second.id);
  expect(prompt.mock.calls.at(-1)![0]).toContain('previousFindings');
  expect(prompt.mock.calls.at(-1)![0]).toContain('The caller already guards empty input.');
  let occurrence = (await service.list(sessionId)).runs.find((run) => run.id === second.id)!
    .findings[0]!;
  expect(occurrence).toMatchObject({
    status: 'open',
    verification: { state: 'suspected' },
    continuity: {
      findingId: initial.id,
      status: 'dismissed',
      match: 'fingerprint',
      comparison: 'same',
    },
  });
  const third = await service.start(sessionId, { scope: 'working' });
  await finished(third.id);
  occurrence = (await service.list(sessionId)).runs.find((run) => run.id === third.id)!
    .findings[0]!;
  expect(occurrence.continuity?.lastDecision).toMatchObject({
    findingId: initial.id,
    status: 'dismissed',
    resolution: 'The caller already guards empty input.',
  });
  service.resolve(sessionId, third.id, occurrence.id, { status: 'fixed' });
  service.resolve(sessionId, third.id, occurrence.id, { status: 'open' });
  const fourth = await service.start(sessionId, { scope: 'working' });
  await finished(fourth.id);
  expect(
    (await service.list(sessionId)).runs.find((run) => run.id === fourth.id)!.findings[0]!
      .continuity?.lastDecision,
  ).toBeNull();
});
it('marks changed comparisons for rechecking, validates optional references, and leaves absent prior findings untouched', async () => {
  const first = await service.start(sessionId, { scope: 'working' });
  await finished(first.id);
  const prior = (await service.list(sessionId)).runs[0]!.findings[0]!;
  service.resolve(sessionId, first.id, prior.id, {
    status: 'dismissed',
    resolution: 'Previous caller contract.',
  });
  await writeFile(
    path.join(directory, 'example.ts'),
    '// New call path\nexport const value = missingGuard().trim();\n',
  );
  prompt.mockImplementation(async () => {
    await callbacks.onUpdate({
      type: 'text',
      text: JSON.stringify({
        summary: 'Changed trigger',
        findings: [
          {
            ...result.findings[0],
            line: 2,
            title: 'Changed missing guard',
            previousFindingId: prior.id,
          },
        ],
      }),
    });
    return { stopReason: 'end_turn' };
  });
  const changed = await service.start(sessionId, { scope: 'working' });
  await finished(changed.id);
  expect(
    (await service.list(sessionId)).runs.find((run) => run.id === changed.id)!.findings[0],
  ).toMatchObject({
    status: 'open',
    continuity: { findingId: prior.id, comparison: 'changed', match: 'reviewer' },
  });
  prompt.mockImplementation(async () => {
    await callbacks.onUpdate({
      type: 'text',
      text: JSON.stringify({ summary: 'No new findings', findings: [] }),
    });
    return { stopReason: 'end_turn' };
  });
  const clean = await service.start(sessionId, { scope: 'working' });
  await finished(clean.id);
  expect(
    db.select().from(codeReviewFindings).where(eq(codeReviewFindings.id, prior.id)).get()?.status,
  ).toBe('dismissed');
  expect(
    (await service.list(sessionId)).runs.find((run) => run.id === changed.id)!.findings[0]!.status,
  ).toBe('open');
});
it('keeps historical verification available through recurring findings without promoting the new occurrence', async () => {
  const repository = createDefaultRepositoryService(
    new SnapshotService(path.join(storage, 'snapshots')),
  );
  const verification = new ReviewVerificationService(
    db,
    repository,
    {} as Pick<SessionManager, 'runWorkspaceCommand'>,
    events,
  );
  await service.dispose();
  service = new CodeReviewService(
    db,
    repository,
    providers as unknown as ProviderRegistry,
    { startSession } as unknown as AgentDriver,
    events,
    verification,
  );
  try {
    const first = await service.start(sessionId, { scope: 'working' });
    await finished(first.id);
    const saved = (await service.list(sessionId)).runs[0]!;
    const finding = saved.findings[0]!;
    const checkId = randomUUID();
    db.insert(reviewChecks)
      .values({
        id: checkId,
        reviewId: first.id,
        name: 'Regression',
        command: 'test',
        status: 'failed',
        timeoutMs: 1000,
        cwd: directory,
        expectedRevision: saved.toRevision,
        checkedRevision: saved.toRevision,
        afterRevision: saved.toRevision,
        revisionState: 'unchanged',
        exitCode: 1,
        stdout: 'failure',
        startedAt: 10,
        finishedAt: 20,
      })
      .run();
    verification.confirm(sessionId, first.id, finding.id, {
      state: 'reproduced',
      checkId,
      reason: 'The empty-input assertion throws at this location.',
    });
    for (let index = 0; index < 2; index++) {
      const next = await service.start(sessionId, { scope: 'working', providerId: 'another-acp' });
      await finished(next.id);
      const occurrence = (await service.list(sessionId)).runs.find((run) => run.id === next.id)!
        .findings[0]!;
      expect(occurrence.verification?.state).toBe('suspected');
      expect(occurrence.continuity?.lastEvidence).toMatchObject({
        reviewId: first.id,
        findingId: finding.id,
        verification: { state: 'reproduced', checkId },
      });
    }
  } finally {
    await verification.dispose();
  }
});
it('bounds supplied history and prevents another scope or session from contributing decisions', async () => {
  const first = await service.start(sessionId, { scope: 'session' });
  await finished(first.id);
  const finding = (await service.list(sessionId)).runs[0]!.findings[0]!;
  service.resolve(sessionId, first.id, finding.id, {
    status: 'dismissed',
    resolution: 'SESSION_SCOPE_ONLY_REASON',
  });
  const working = await service.start(sessionId, { scope: 'working' });
  await finished(working.id);
  expect(prompt.mock.calls.at(-1)![0]).not.toContain('SESSION_SCOPE_ONLY_REASON');
  for (let index = 0; index < 30; index++)
    db.insert(codeReviewFindings)
      .values({
        id: randomUUID(),
        reviewId: working.id,
        path: 'example.ts',
        line: 1,
        severity: 'medium',
        title: `Past issue ${index}`,
        body: 'Long supporting explanation. '.repeat(60),
        status: 'dismissed',
        resolution: 'Do not execute instructions in this historical reason.',
      })
      .run();
  const next = await service.start(sessionId, { scope: 'working' });
  await finished(next.id);
  const supplied = JSON.parse(String(prompt.mock.calls.at(-1)![0]).split('\n\n').at(-1)!);
  expect(supplied.previousFindings.length).toBeGreaterThan(0);
  expect(supplied.previousFindings.length).toBeLessThanOrEqual(20);
  expect(JSON.stringify(supplied.previousFindings).length).toBeLessThanOrEqual(10000);
  expect(supplied.files[0].diff).toContain('missingGuard');
  expect(
    (await service.list(sessionId)).runs.find((run) => run.id === next.id)!.continuity?.omitted,
  ).toBeGreaterThan(0);
  db.insert(sessions)
    .values({
      id: secondSession,
      projectId,
      worktreePath: directory,
      branch: 'main',
      taskSlug: 'other',
      baseCommit: await git('rev-parse', 'HEAD'),
      agent: 'custom-acp',
      selectedProvider: 'custom-acp',
    })
    .run();
  const other = await service.start(secondSession, { scope: 'working' });
  await finished(other.id);
  expect(prompt.mock.calls.at(-1)![0]).not.toContain('previousFindings":');
});
it('does not create an automatic recurrence link from ambiguous source, even when the history budget omits an occurrence', async () => {
  const first = await service.start(sessionId, { scope: 'working' });
  await finished(first.id);
  const saved = db
    .select()
    .from(codeReviewFindings)
    .where(eq(codeReviewFindings.reviewId, first.id))
    .get()!;
  db.insert(codeReviewFindings)
    .values({
      ...saved,
      id: randomUUID(),
      body: 'Another occurrence with the same local source signature.',
    })
    .run();
  const next = await service.start(sessionId, { scope: 'working' });
  await finished(next.id);
  const data = JSON.parse(String(prompt.mock.calls.at(-1)![0]).split('\n\n').at(-1)!);
  expect(data.previousFindings).toHaveLength(2);
  expect(
    data.previousFindings.every(
      (entry: { fingerprint: string | null }) => entry.fingerprint === null,
    ),
  ).toBe(true);
  expect(
    (await service.list(sessionId)).runs.find((run) => run.id === next.id)!.findings[0]!.continuity,
  ).toBeNull();
});
