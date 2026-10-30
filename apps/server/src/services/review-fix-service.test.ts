import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import os from 'node:os';
import { beforeEach, afterEach, expect, it, vi } from 'vite-plus/test';
import { eq } from 'drizzle-orm';
import {
  createDatabase,
  projects,
  sessions,
  codeReviews,
  codeReviewFindings,
  reviewChecks,
  reviewFixAttempts,
  sessionEvents,
} from '@agentctl/core/db';
import {
  createDefaultRepositoryService,
  type AgentDriver,
  type AgentSessionCallbacks,
} from '@agentctl/core';
import { SnapshotService } from '@agentctl/core/git';
import type { ProviderRegistry } from '@agentctl/core/providers';
import type { SessionManager } from '@agentctl/core/session';
import { EMPTY_AGENT_FEATURES } from '@agentctl/shared';
import { CodeReviewService } from './code-review-service.js';
import { ReviewVerificationService } from './review-verification-service.js';
import { ReviewFixService } from './review-fix-service.js';
const exec = promisify(execFile);
let root: string;
let storage: string;
let db: ReturnType<typeof createDatabase>;
let reviews: CodeReviewService;
let checks: ReviewVerificationService;
let service: ReviewFixService;
let repositories: ReturnType<typeof createDefaultRepositoryService>;
const sessionId = '22222222-2222-4222-8222-222222222222';
const projectId = '11111111-1111-4111-8111-111111111111';
const events = { publishState: vi.fn() };
const runner = vi.fn<typeof import('@agentctl/core').executeReviewCheck>();
let output: {
  summary: string;
  findings: Array<{ severity: string; path: string; line: number; title: string; body: string }>;
};
const startSession = vi.fn(
  async (
    _command: string,
    _args: string[],
    _options: unknown,
    callbacks: AgentSessionCallbacks,
  ) => ({
    prompt: async () => {
      await callbacks.onUpdate({ type: 'text', text: JSON.stringify(output) });
      return { stopReason: 'end_turn' };
    },
    close: async () => {},
  }),
);
const manager = {
  runWorkspaceCommand: async (_id: string, _body: unknown, run: () => Promise<unknown>) => run(),
} as Pick<SessionManager, 'runWorkspaceCommand'>;
const provider = {
  isInstalled: true,
  isReady: true,
  features: EMPTY_AGENT_FEATURES,
  toDiscovery: () => ({ enabled: true, configOptions: [], customModels: [] }),
  resolveDefaultSelection: () => ({ selectedModel: 'default' }),
  getLaunchConfig: () => ({ command: 'generic-acp', args: [], env: {} }),
};
const registry = {
  getProvider: () => provider,
  ensureProviderReady: async () => provider,
} as unknown as ProviderRegistry;
const git = async (...args: string[]) => (await exec('git', args, { cwd: root })).stdout.trim();
async function finished(id: string) {
  await vi.waitFor(() =>
    expect(db.select().from(codeReviews).where(eq(codeReviews.id, id)).get()?.status).not.toBe(
      'running',
    ),
  );
}
async function checked(reviewId: string, id: string) {
  await vi.waitFor(() => expect(checks.get(sessionId, reviewId, id).finishedAt).not.toBeNull());
}
function construct() {
  reviews = new CodeReviewService(
    db,
    repositories,
    registry,
    { startSession } as unknown as AgentDriver,
    events,
    checks,
  );
  service = new ReviewFixService(db, repositories, reviews, checks, events);
}
async function baseline() {
  const { id: reviewId } = await reviews.start(sessionId, { scope: 'working' });
  await finished(reviewId);
  const run = (await reviews.list(sessionId)).runs[0]!;
  const findingId = run.findings[0]!.id;
  const checkId = randomUUID();
  db.insert(reviewChecks)
    .values({
      id: checkId,
      reviewId,
      name: 'Regression',
      command: 'test-regression',
      status: 'failed',
      timeoutMs: 1000,
      cwd: root,
      expectedRevision: run.toRevision,
      checkedRevision: run.toRevision,
      afterRevision: run.toRevision,
      revisionState: 'unchanged',
      exitCode: 1,
      stdout: 'before failure',
      startedAt: 1,
      finishedAt: 2,
    })
    .run();
  checks.confirm(sessionId, reviewId, findingId, {
    state: 'reproduced',
    checkId,
    reason: 'The regression assertion reproduces the reported failure.',
  });
  const capture = (
    await reviews.handoff(sessionId, reviewId, findingId, { intent: 'fix', notes: '' })
  ).capture!;
  return { reviewId, findingId, checkId, capture };
}
beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'fix-loop-work-'));
  storage = await mkdtemp(path.join(os.tmpdir(), 'fix-loop-state-'));
  db = createDatabase(path.join(storage, 'db.sqlite'));
  repositories = createDefaultRepositoryService(
    new SnapshotService(path.join(storage, 'snapshots')),
  );
  await git('init', '-b', 'main');
  await git('config', 'user.name', 'Test');
  await git('config', 'user.email', 'test@example.com');
  await git('config', 'commit.gpgSign', 'false');
  await writeFile(path.join(root, 'input.ts'), 'export const value = 1;\n');
  await git('add', '.');
  await git('commit', '-m', 'Initial');
  db.insert(projects).values({ id: projectId, name: 'Fixture', path: root, repoRoot: root }).run();
  db.insert(sessions)
    .values({
      id: sessionId,
      projectId,
      branch: 'main',
      worktreePath: root,
      taskSlug: 'fix',
      baseCommit: await git('rev-parse', 'HEAD'),
      agent: 'generic-acp',
      selectedProvider: 'generic-acp',
      selectedModel: 'configured',
    })
    .run();
  await writeFile(path.join(root, 'input.ts'), 'export const value = broken();\n');
  output = {
    summary: 'A bug',
    findings: [
      {
        severity: 'high',
        path: 'input.ts',
        line: 1,
        title: 'Broken input',
        body: 'Empty input throws.',
      },
    ],
  };
  runner.mockReset().mockResolvedValue({
    status: 'passed',
    exitCode: 0,
    signal: null,
    error: null,
    stdout: 'after passed',
    stderr: '',
    outputTruncated: false,
  });
  checks = new ReviewVerificationService(db, repositories, manager, events, runner);
  construct();
});
afterEach(async () => {
  await checks.dispose();
  await reviews.dispose();
  await rm(root, { recursive: true, force: true });
  await rm(storage, { recursive: true, force: true });
  vi.clearAllMocks();
});
it('tracks the request, comparable before/after evidence and fresh review while keeping final resolution manual', async () => {
  const source = await baseline();
  const id = randomUUID();
  const body = { id, beforeCheckId: source.checkId, notes: '', expectedCapture: source.capture };
  const request = await service.create(sessionId, source.reviewId, source.findingId, body);
  expect(request.prompt).toContain(`[AgentCtl fix attempt: ${id}]`);
  expect(await service.create(sessionId, source.reviewId, source.findingId, body)).toEqual(request);
  expect(db.select().from(reviewFixAttempts).all()).toHaveLength(1);
  db.insert(sessionEvents)
    .values({
      sessionId,
      type: 'text',
      data: JSON.stringify({ role: 'user', content: request.prompt }),
    })
    .run();
  await writeFile(path.join(root, 'input.ts'), 'export const value = guarded();\n');
  const check = await service.verify(sessionId, source.reviewId, source.findingId, id, {
    command: 'test-regression',
    timeoutMs: 1000,
  });
  let attempt = (await service.list(sessionId, source.reviewId, source.findingId)).attempts[0]!;
  await checked(attempt.after!.reviewId, check.id);
  expect(
    (await reviews.list(sessionId)).runs.some((run) => run.id === attempt.after!.reviewId),
  ).toBe(false);
  expect(
    (await service.list(sessionId, source.reviewId, source.findingId)).attempts[0]!.outcome,
  ).toBe('needs_investigation');
  output = { summary: 'No defects in changed code', findings: [] };
  const follow = await service.review(sessionId, source.reviewId, source.findingId, id);
  await finished(follow.id);
  attempt = (await service.list(sessionId, source.reviewId, source.findingId)).attempts[0]!;
  expect(attempt).toMatchObject({
    outcome: 'suggested_fixed',
    freshness: 'current',
    requestEventId: expect.any(Number),
    after: { status: 'passed' },
  });
  expect(attempt.before).not.toHaveProperty('stdout');
  expect(attempt.followup?.providerId).toBe('generic-acp');
  expect(
    db.select().from(codeReviewFindings).where(eq(codeReviewFindings.id, source.findingId)).get()
      ?.status,
  ).toBe('open');
  await reviews.dispose();
  db = createDatabase(path.join(storage, 'db.sqlite'));
  construct();
  expect(
    (await service.list(sessionId, source.reviewId, source.findingId)).attempts[0]!.outcome,
  ).toBe('suggested_fixed');
  checks.confirm(sessionId, source.reviewId, source.findingId, {
    state: 'suspected',
    reason: 'The original failure no longer establishes reproduction.',
  });
  expect(
    (await service.list(sessionId, source.reviewId, source.findingId)).attempts[0]!.outcome,
  ).toBe('needs_investigation');
  await writeFile(path.join(root, 'input.ts'), 'export const value = changedAgain();\n');
  expect(
    (await service.list(sessionId, source.reviewId, source.findingId)).attempts[0]!.outcome,
  ).toBe('needs_investigation');
});
it('rejects stale creation and ownership violations and does not infer a fix from a missing baseline or different command', async () => {
  const source = await baseline();
  const id = randomUUID();
  await expect(
    service.create(sessionId, source.reviewId, source.findingId, {
      id,
      beforeCheckId: source.checkId,
      notes: '',
      expectedCapture: { ...source.capture, current: 'wrong' },
    }),
  ).rejects.toThrow('workspace changed');
  await service.create(sessionId, source.reviewId, source.findingId, {
    id,
    beforeCheckId: null,
    notes: '',
    expectedCapture: source.capture,
  });
  await expect(service.list(randomUUID(), source.reviewId, source.findingId)).rejects.toThrow(
    'Finding not found',
  );
  await writeFile(path.join(root, 'input.ts'), 'export const value = fixed();\n');
  const run = await service.verify(sessionId, source.reviewId, source.findingId, id, {
    command: 'unrelated-test',
    timeoutMs: 1000,
  });
  const attempt = (await service.list(sessionId, source.reviewId, source.findingId)).attempts[0]!;
  await checked(attempt.after!.reviewId, run.id);
  expect(
    (await service.list(sessionId, source.reviewId, source.findingId)).attempts[0]!.outcome,
  ).toBe('needs_investigation');
  await writeFile(path.join(root, 'input.ts'), 'export const value = anotherEdit();\n');
  await expect(service.review(sessionId, source.reviewId, source.findingId, id)).rejects.toThrow(
    'Code changed after the check',
  );
});
it('does not suggest a fix when a clean follow-up review accompanies a different command', async () => {
  const source = await baseline();
  const id = randomUUID();
  await service.create(sessionId, source.reviewId, source.findingId, {
    id,
    beforeCheckId: source.checkId,
    notes: '',
    expectedCapture: source.capture,
  });
  await writeFile(path.join(root, 'input.ts'), 'export const value = fixed();\n');
  const run = await service.verify(sessionId, source.reviewId, source.findingId, id, {
    command: 'unrelated-test',
    timeoutMs: 1000,
  });
  const attempt = (await service.list(sessionId, source.reviewId, source.findingId)).attempts[0]!;
  await checked(attempt.after!.reviewId, run.id);
  output = { summary: 'No defects', findings: [] };
  const follow = await service.review(sessionId, source.reviewId, source.findingId, id);
  await finished(follow.id);
  expect(
    (await service.list(sessionId, source.reviewId, source.findingId)).attempts[0]!.outcome,
  ).toBe('needs_investigation');
});
it('retains failing checks and interrupted operations and cascades attempts on session deletion', async () => {
  const source = await baseline();
  const id = randomUUID();
  await service.create(sessionId, source.reviewId, source.findingId, {
    id,
    beforeCheckId: source.checkId,
    notes: '',
    expectedCapture: source.capture,
  });
  runner.mockResolvedValue({
    status: 'failed',
    exitCode: 1,
    signal: null,
    error: null,
    stdout: 'still failing',
    stderr: '',
    outputTruncated: false,
  });
  await writeFile(path.join(root, 'input.ts'), 'export const value = incompleteFix();\n');
  const run = await service.verify(sessionId, source.reviewId, source.findingId, id, {
    command: 'test-regression',
    timeoutMs: 1000,
  });
  const attempt = (await service.list(sessionId, source.reviewId, source.findingId)).attempts[0]!;
  await checked(attempt.after!.reviewId, run.id);
  expect(
    (await service.list(sessionId, source.reviewId, source.findingId)).attempts[0]!.outcome,
  ).toBe('still_failing');
  db.update(reviewChecks)
    .set({ status: 'interrupted', revisionState: 'unknown' })
    .where(eq(reviewChecks.id, run.id))
    .run();
  expect(
    (await service.list(sessionId, source.reviewId, source.findingId)).attempts[0]!.outcome,
  ).toBe('needs_investigation');
  db.delete(sessions).where(eq(sessions.id, sessionId)).run();
  expect(db.select().from(reviewFixAttempts).all()).toHaveLength(0);
});
