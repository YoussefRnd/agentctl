import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import os from 'node:os';
import Fastify, { type FastifyInstance } from 'fastify';
import { initServer } from '@ts-rest/fastify';
import { beforeEach, afterEach, expect, it, vi } from 'vite-plus/test';
import { eq } from 'drizzle-orm';
import {
  createDatabase,
  projects,
  sessions,
  codeReviews,
  codeReviewFindings,
  reviewChecks,
  reviewFindingEvidence,
} from '@agentctl/core/db';
import { createDefaultRepositoryService, type ReviewCheckExecution } from '@agentctl/core';
import type { SessionManager } from '@agentctl/core/session';
import { SnapshotService } from '@agentctl/core/git';
import { sessionsContract } from '@agentctl/shared';
import { ReviewVerificationService } from './review-verification-service.js';
import { createCodeReviewRouter } from '../plugins/ts-rest/code-review.router.js';
import { AppError } from '../errors/app-error.js';
const exec = promisify(execFile);
let root: string;
let workspace: string;
let db: ReturnType<typeof createDatabase>;
let repositories: ReturnType<typeof createDefaultRepositoryService>;
let manager: Pick<SessionManager, 'runWorkspaceCommand'>;
let service: ReviewVerificationService;
let app: FastifyInstance;
let databasePath: string;
let reviewId: string;
let findingId: string;
const sessionId = '22222222-2222-4222-8222-222222222222';
const projectId = '11111111-1111-4111-8111-111111111111';
const events = { publishState: vi.fn() };
const runner = vi.fn<typeof import('@agentctl/core').executeReviewCheck>();
const result: ReviewCheckExecution = {
  status: 'failed',
  exitCode: 1,
  signal: null,
  error: null,
  stdout: 'assertion failed: empty input throws\n',
  stderr: '',
  outputTruncated: false,
};
const git = async (...args: string[]) =>
  (await exec('git', args, { cwd: workspace })).stdout.trim();
async function finished(id: string) {
  await vi.waitFor(() => expect(service.get(sessionId, reviewId, id).finishedAt).not.toBeNull(), {
    timeout: 5000,
  });
  return service.get(sessionId, reviewId, id);
}
beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'verification-service-'));
  workspace = root;
  await git('init', '-b', 'main');
  await git('config', 'user.name', 'Test');
  await git('config', 'user.email', 'test@example.com');
  await git('config', 'commit.gpgSign', 'false');
  await writeFile(path.join(workspace, 'example.ts'), 'export const value = 1;\n');
  await git('add', '.');
  await git('commit', '-m', 'Initial');
  // Store app state outside the reviewed workspace.
  const storage = await mkdtemp(path.join(os.tmpdir(), 'verification-storage-'));
  databasePath = path.join(storage, 'db.sqlite');
  db = createDatabase(databasePath);
  repositories = createDefaultRepositoryService(
    new SnapshotService(path.join(storage, 'snapshots')),
  );
  db.insert(projects)
    .values({ id: projectId, name: 'Fixture', path: workspace, repoRoot: workspace })
    .run();
  db.insert(sessions)
    .values({
      id: sessionId,
      projectId,
      worktreePath: workspace,
      branch: 'main',
      taskSlug: 'task',
      title: 'Test',
      baseCommit: await git('rev-parse', 'HEAD'),
      agent: 'any-acp',
      selectedProvider: 'any-acp',
    })
    .run();
  await writeFile(path.join(workspace, 'example.ts'), 'export const value = missingGuard();\n');
  const repository = await repositories.open(workspace);
  const capture = (
    await repository.review(await repository.importRevision(await git('rev-parse', 'HEAD')), {
      includeDiffs: false,
    })
  ).capture!;
  reviewId = randomUUID();
  findingId = randomUUID();
  db.insert(codeReviews)
    .values({
      id: reviewId,
      sessionId,
      providerId: 'any-acp',
      modelId: 'any-model',
      scope: 'working',
      fromRevision: capture.working,
      toRevision: capture.current,
      status: 'completed',
      summary: 'Missing guard',
      startedAt: 100,
      finishedAt: 200,
    })
    .run();
  db.insert(codeReviewFindings)
    .values({
      id: findingId,
      reviewId,
      path: 'example.ts',
      line: 1,
      severity: 'high',
      title: 'Missing guard',
      body: 'Empty input throws.',
      status: 'open',
    })
    .run();
  manager = { runWorkspaceCommand: vi.fn(async (_id, _payload, run) => await run()) } as Pick<
    SessionManager,
    'runWorkspaceCommand'
  >;
  runner.mockReset().mockResolvedValue(result);
  service = new ReviewVerificationService(db, repositories, manager, events, runner);
  app = Fastify();
  app.decorate('services', { reviewVerification: service } as FastifyInstance['services']);
  app.setErrorHandler((error, _request, reply) =>
    error instanceof AppError
      ? reply.code(error.statusCode).send({ message: error.message })
      : reply.send(error),
  );
  const server = initServer();
  const contract = {
    getCodeReviewFile: sessionsContract.getCodeReviewFile,
    listReviewFixes: sessionsContract.listReviewFixes,
    createReviewFix: sessionsContract.createReviewFix,
    verifyReviewFix: sessionsContract.verifyReviewFix,
    reviewReviewFix: sessionsContract.reviewReviewFix,
    updateWalkthroughProgress: sessionsContract.updateWalkthroughProgress,
    prepareWalkthroughQuestion: sessionsContract.prepareWalkthroughQuestion,
    prepareReviewFindingHandoff: sessionsContract.prepareReviewFindingHandoff,
    listCodeReviews: sessionsContract.listCodeReviews,
    startCodeReview: sessionsContract.startCodeReview,
    cancelCodeReview: sessionsContract.cancelCodeReview,
    resolveCodeReviewFinding: sessionsContract.resolveCodeReviewFinding,
    listReviewChecks: sessionsContract.listReviewChecks,
    getReviewCheck: sessionsContract.getReviewCheck,
    runReviewCheck: sessionsContract.runReviewCheck,
    cancelReviewCheck: sessionsContract.cancelReviewCheck,
    confirmReviewFindingEvidence: sessionsContract.confirmReviewFindingEvidence,
  };
  await app.register(server.plugin(server.router(contract, createCodeReviewRouter(app))));
  app.addHook('onClose', async () => {
    await rm(storage, { recursive: true, force: true });
  });
});
afterEach(async () => {
  await service.dispose();
  await app.close();
  await rm(root, { recursive: true, force: true });
  vi.clearAllMocks();
});
it('runs only explicit commands, persists results, scopes routes and requires human confirmation', async () => {
  expect(runner).not.toHaveBeenCalled();
  const response = await app.inject({
    method: 'POST',
    url: `/api/sessions/${sessionId}/code-reviews/${reviewId}/checks`,
    payload: { command: 'pnpm test example.test.ts', name: 'Empty input regression' },
  });
  expect(response.statusCode, response.body).toBe(202);
  const id = response.json<{ id: string }>().id;
  expect(await finished(id)).toMatchObject({
    status: 'failed',
    exitCode: 1,
    revisionState: 'unchanged',
    stdout: result.stdout,
  });
  expect(runner).toHaveBeenCalledWith(
    'pnpm test example.test.ts',
    workspace,
    180000,
    expect.any(AbortSignal),
    expect.any(Function),
  );
  expect(JSON.stringify(vi.mocked(manager.runWorkspaceCommand).mock.calls[0]?.[1])).not.toContain(
    'pnpm test',
  );
  expect(service.states([reviewId]).findings.get(findingId)).toBeUndefined();
  const confirm = await app.inject({
    method: 'POST',
    url: `/api/sessions/${sessionId}/code-reviews/${reviewId}/findings/${findingId}/evidence`,
    payload: {
      state: 'reproduced',
      checkId: id,
      reason: 'The regression test calls the empty-input branch and throws at the reported line.',
    },
  });
  expect(confirm.statusCode, confirm.body).toBe(200);
  expect(service.states([reviewId]).findings.get(findingId)).toMatchObject({
    state: 'reproduced',
    checkId: id,
  });
  expect(
    service.promptEvidence(
      sessionId,
      reviewId,
      db.select().from(codeReviews).get()!.fromRevision,
      db.select().from(codeReviews).get()!.toRevision,
    )[0],
  ).toMatchObject({ checkId: id, status: 'failed', stdout: result.stdout });
  const other = await app.inject({
    method: 'GET',
    url: `/api/sessions/${randomUUID()}/code-reviews/${reviewId}/checks/${id}`,
  });
  expect(other.statusCode).toBe(404);
  const list = await app.inject({
    method: 'GET',
    url: `/api/sessions/${sessionId}/code-reviews/${reviewId}/checks`,
  });
  expect(list.statusCode, list.body).toBe(200);
  expect(list.body).not.toContain('assertion failed');
  await service.dispose();
  db = createDatabase(databasePath);
  service = new ReviewVerificationService(db, repositories, manager, events, runner);
  expect(service.get(sessionId, reviewId, id).stdout).toBe(result.stdout);
  expect(service.states([reviewId]).findings.get(findingId)?.state).toBe('reproduced');
  service.confirm(sessionId, reviewId, findingId, {
    state: 'suspected',
    reason: 'Failure may come from another branch.',
  });
  expect(service.states([reviewId]).findings.get(findingId)?.state).toBe('suspected');
  expect(db.select().from(reviewFindingEvidence).all()).toHaveLength(2);
});
it.each(['passed', 'timed_out', 'cancelled', 'error'] as const)(
  'never treats %s as reproduction evidence',
  async (status) => {
    runner.mockResolvedValue({ ...result, status, exitCode: status === 'passed' ? 0 : null });
    const { id } = await service.start(sessionId, reviewId, { command: 'test', timeoutMs: 1000 });
    await finished(id);
    expect(() =>
      service.confirm(sessionId, reviewId, findingId, {
        state: 'reproduced',
        checkId: id,
        reason: 'This is a reproduction explanation.',
      }),
    ).toThrow('completed failing check');
  },
);
it('rejects outdated checks and excludes changed-workspace results from evidence', async () => {
  runner.mockImplementation(async () => {
    await writeFile(path.join(workspace, 'example.ts'), 'changed by check\n');
    return result;
  });
  const { id } = await service.start(sessionId, reviewId, {
    command: 'changes files',
    timeoutMs: 1000,
  });
  expect((await finished(id)).revisionState).toBe('changed');
  expect(() =>
    service.confirm(sessionId, reviewId, findingId, {
      state: 'reproduced',
      checkId: id,
      reason: 'This demonstrates the failure.',
    }),
  ).toThrow();
  const review = db.select().from(codeReviews).get()!;
  expect(
    service.promptEvidence(sessionId, reviewId, review.fromRevision, review.toRevision),
  ).toEqual([]);
  await expect(
    service.start(sessionId, reviewId, { command: 'test', timeoutMs: 1000 }),
  ).rejects.toThrow('outdated');
  expect(runner).toHaveBeenCalledTimes(1);
});
it('preserves historical evidence after editing while excluding it from a new revision', async () => {
  const { id } = await service.start(sessionId, reviewId, { command: 'test', timeoutMs: 1000 });
  await finished(id);
  service.confirm(sessionId, reviewId, findingId, {
    state: 'reproduced',
    checkId: id,
    reason: 'Empty-input assertion reproduces the throw.',
  });
  await writeFile(path.join(workspace, 'example.ts'), 'fixed\n');
  expect(service.states([reviewId]).findings.get(findingId)?.state).toBe('reproduced');
  expect(service.promptEvidence(sessionId, reviewId, 'another-base', 'another-revision')).toEqual(
    [],
  );
});
it('serializes workspace checks and cancels a queued check without waiting for the lane', async () => {
  let callback!: () => Promise<unknown>;
  vi.mocked(manager.runWorkspaceCommand).mockImplementation(async (_id, _payload, run) => {
    callback = run;
    return await new Promise(() => {});
  });
  const { id } = await service.start(sessionId, reviewId, { command: 'test', timeoutMs: 1000 });
  await expect(
    service.start(sessionId, reviewId, { command: 'second', timeoutMs: 1000 }),
  ).rejects.toThrow('already running');
  service.cancel(sessionId, reviewId, id);
  expect((await finished(id)).status).toBe('cancelled');
  await expect(callback()).rejects.toThrow('cancelled');
  expect(runner).not.toHaveBeenCalled();
});
it('cancels a running command and retains output, and marks restart leftovers interrupted', async () => {
  runner.mockImplementation(async (_command, _cwd, _timeout, signal, output) => {
    output?.({ stdout: 'partial output', stderr: '', outputTruncated: false });
    await new Promise<void>((resolve) => {
      signal.addEventListener('abort', () => resolve(), { once: true });
    });
    return { ...result, status: 'cancelled', stdout: 'partial output', exitCode: null };
  });
  const { id } = await service.start(sessionId, reviewId, { command: 'test', timeoutMs: 1000 });
  await vi.waitFor(() => expect(runner).toHaveBeenCalled());
  service.cancelSession(sessionId);
  expect(await finished(id)).toMatchObject({ status: 'cancelled', stdout: 'partial output' });
  const leftover = randomUUID();
  db.insert(reviewChecks)
    .values({
      id: leftover,
      reviewId,
      name: 'Leftover',
      command: 'test',
      status: 'running',
      timeoutMs: 1000,
      cwd: workspace,
      expectedRevision: 'old',
      stdout: 'saved before restart',
      startedAt: 1,
    })
    .run();
  await service.dispose();
  db = createDatabase(databasePath);
  service = new ReviewVerificationService(db, repositories, manager, events, runner);
  expect(service.get(sessionId, reviewId, leftover)).toMatchObject({
    status: 'interrupted',
    stdout: 'saved before restart',
    revisionState: 'unknown',
  });
});
it('rechecks the snapshot after waiting in the operation lane and rejects active turns', async () => {
  vi.mocked(manager.runWorkspaceCommand).mockImplementation(async (_id, _payload, run) => {
    await writeFile(path.join(workspace, 'example.ts'), 'external edit\n');
    return await run();
  });
  const { id } = await service.start(sessionId, reviewId, { command: 'test', timeoutMs: 1000 });
  expect((await finished(id)).status).toBe('error');
  expect(runner).not.toHaveBeenCalled();
  db.update(sessions).set({ status: 'running' }).where(eq(sessions.id, sessionId)).run();
  await expect(
    service.start(sessionId, reviewId, { command: 'test', timeoutMs: 1000 }),
  ).rejects.toThrow('active turn');
});

it('paginates saved summaries without losing equal-timestamp checks and cascades evidence on deletion', () => {
  const review = db.select().from(codeReviews).get()!;
  for (let index = 0; index < 23; index++)
    db.insert(reviewChecks)
      .values({
        id: randomUUID(),
        reviewId,
        name: 'Saved check',
        command: 'test',
        status: 'failed',
        timeoutMs: 1000,
        cwd: workspace,
        expectedRevision: review.toRevision,
        checkedRevision: review.toRevision,
        afterRevision: review.toRevision,
        revisionState: 'unchanged',
        exitCode: 1,
        stdout: 'large output stays out of list',
        startedAt: 1000,
        finishedAt: 2000,
      })
      .run();
  const first = service.list(sessionId, reviewId);
  const second = service.list(sessionId, reviewId, first.nextCursor!);
  expect(first.checks).toHaveLength(20);
  expect(second.checks).toHaveLength(3);
  expect(new Set([...first.checks, ...second.checks].map((check) => check.id)).size).toBe(23);
  expect(first.checks[0]).not.toHaveProperty('stdout');
  service.confirm(sessionId, reviewId, findingId, {
    state: 'reproduced',
    checkId: first.checks[0]!.id,
    reason: 'The assertion demonstrates the reported failure.',
  });
  db.delete(sessions).where(eq(sessions.id, sessionId)).run();
  expect(db.select().from(reviewChecks).all()).toHaveLength(0);
  expect(db.select().from(reviewFindingEvidence).all()).toHaveLength(0);
});
