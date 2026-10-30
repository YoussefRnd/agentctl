import { createHash } from 'node:crypto';
import { and, desc, eq, lt, or, sql } from 'drizzle-orm';
import {
  codeReviews,
  codeReviewFindings,
  reviewFixAttempts,
  sessions,
  sessionEvents,
  type DbClient,
} from '@agentctl/core/db';
import type { RepositoryService } from '@agentctl/core/repository';
import {
  createReviewFixSchema,
  reviewFixSchema,
  runReviewCheckSchema,
  type CreateReviewFix,
  type RunReviewCheck,
  type ReviewFix,
} from '@agentctl/shared';
import type { CodeReviewService } from './code-review-service.js';
import type { ReviewVerificationService } from './review-verification-service.js';
import type { EventBus } from '../utils/event-bus.js';
import { AppError } from '../errors/app-error.js';

type Run = ReviewFix['runs'][number];
/** Coordinates existing check/review owners. Outcomes are suggestions; finding status is never written. */
export class ReviewFixService {
  private busy = new Set<string>();
  constructor(
    private db: DbClient,
    private repositories: Pick<RepositoryService, 'open'>,
    private reviews: CodeReviewService,
    private checks: ReviewVerificationService,
    private events: Pick<EventBus, 'publishState'>,
  ) {}
  private source(sessionId: string, reviewId: string, findingId: string) {
    const review = this.db
      .select()
      .from(codeReviews)
      .where(
        and(
          eq(codeReviews.id, reviewId),
          eq(codeReviews.sessionId, sessionId),
          eq(codeReviews.purpose, 'review'),
        ),
      )
      .get();
    const finding = this.db
      .select()
      .from(codeReviewFindings)
      .where(and(eq(codeReviewFindings.id, findingId), eq(codeReviewFindings.reviewId, reviewId)))
      .get();
    if (!review || !finding) throw new AppError('Finding not found', 404);
    return { review, finding };
  }
  private owned(sessionId: string, reviewId: string, findingId: string, id: string) {
    const source = this.source(sessionId, reviewId, findingId);
    const attempt = this.db
      .select()
      .from(reviewFixAttempts)
      .where(and(eq(reviewFixAttempts.id, id), eq(reviewFixAttempts.findingId, findingId)))
      .get();
    if (!attempt) throw new AppError('Fix attempt not found', 404);
    return { ...source, attempt };
  }
  private runs(raw: string): Run[] {
    try {
      return reviewFixSchema.shape.runs.parse(JSON.parse(raw));
    } catch {
      return [];
    }
  }
  private notify(sessionId: string) {
    this.events.publishState({ topics: ['workspace'], sessionId });
  }
  private async snapshot(sessionId: string, scope: 'working' | 'session') {
    const session = this.db.select().from(sessions).where(eq(sessions.id, sessionId)).get();
    if (!session) throw new AppError('Session not found', 404);
    const repository = await this.repositories.open(session.worktreePath);
    const base =
      session.baseCommit === 'none'
        ? undefined
        : await repository.importRevision(session.baseCommit);
    const capture = (await repository.review(base, { includeDiffs: false })).capture;
    if (!capture) throw new AppError('Workspace snapshots unavailable', 409);
    return { capture, from: scope === 'session' ? capture.baseline : capture.working };
  }
  async create(sessionId: string, reviewId: string, findingId: string, input: CreateReviewFix) {
    const body = createReviewFixSchema.parse(input);
    const { review } = this.source(sessionId, reviewId, findingId);
    const hash = createHash('sha256')
      .update(JSON.stringify([sessionId, reviewId, findingId, body]))
      .digest('hex');
    const prior = this.db
      .select()
      .from(reviewFixAttempts)
      .where(eq(reviewFixAttempts.id, body.id))
      .get();
    if (prior) {
      if (prior.findingId !== findingId || prior.requestHash !== hash)
        throw new AppError('This fix request ID was already used. Prepare a new request.', 409);
      return { id: prior.id, prompt: prior.prompt };
    }
    if (body.beforeCheckId) {
      const before = this.checks.get(sessionId, reviewId, body.beforeCheckId);
      if (
        before.status !== 'failed' ||
        before.exitCode === null ||
        before.exitCode === 0 ||
        before.signal ||
        before.revisionState !== 'unchanged' ||
        before.checkedRevision !== review.toRevision ||
        before.afterRevision !== review.toRevision
      )
        throw new AppError(
          'Choose a completed failing baseline check on the reviewed revision.',
          400,
        );
    }
    const prepared = await this.reviews.handoff(sessionId, reviewId, findingId, {
      intent: 'fix',
      notes: body.notes,
    });
    if (!prepared.canAdd || !prepared.capture)
      throw new AppError(prepared.blockedReason ?? 'A stable workspace is required.', 409);
    if (
      Object.entries(body.expectedCapture).some(
        ([key, value]) => prepared.capture?.[key as keyof typeof prepared.capture] !== value,
      )
    )
      throw new AppError(
        'The workspace changed. Refresh the request context before tracking this fix.',
        409,
      );
    const prompt = `[AgentCtl fix attempt: ${body.id}]\n${prepared.prompt}\n\nThis request is tracked. Describe the changes and verification results; the final finding resolution remains manual.`;
    this.db
      .insert(reviewFixAttempts)
      .values({
        id: body.id,
        findingId,
        requestHash: hash,
        requestRevision: prepared.capture.current,
        beforeCheckId: body.beforeCheckId,
        prompt,
        createdAt: Date.now(),
      })
      .onConflictDoNothing()
      .run();
    const saved = this.db
      .select()
      .from(reviewFixAttempts)
      .where(eq(reviewFixAttempts.id, body.id))
      .get()!;
    if (saved.requestHash !== hash) throw new AppError('Fix request ID conflict', 409);
    this.notify(sessionId);
    return { id: saved.id, prompt: saved.prompt };
  }
  private check(sessionId: string, run: Run | undefined) {
    if (!run) return null;
    try {
      return this.checks.get(sessionId, run.reviewId, run.id);
    } catch {
      return null;
    }
  }
  private running(sessionId: string, runs: Run[]) {
    return runs.some((run) =>
      run.kind === 'check'
        ? ['pending', 'running'].includes(this.check(sessionId, run)?.status ?? '')
        : this.db
            .select({ status: codeReviews.status })
            .from(codeReviews)
            .where(and(eq(codeReviews.id, run.id), eq(codeReviews.sessionId, sessionId)))
            .get()?.status === 'running',
    );
  }
  private append(id: string, run: Run) {
    this.db.transaction((tx) => {
      const attempt = tx.select().from(reviewFixAttempts).where(eq(reviewFixAttempts.id, id)).get();
      if (!attempt) throw new AppError('Fix attempt not found', 404);
      const runs = this.runs(attempt.runs);
      if (runs.length >= 20)
        throw new AppError(
          'This attempt has reached its history limit. Start another attempt.',
          409,
        );
      tx.update(reviewFixAttempts)
        .set({ runs: JSON.stringify([...runs, run]) })
        .where(eq(reviewFixAttempts.id, id))
        .run();
    });
  }
  async verify(
    sessionId: string,
    reviewId: string,
    findingId: string,
    id: string,
    input: RunReviewCheck,
  ) {
    const body = runReviewCheckSchema.parse(input);
    const { review, attempt } = this.owned(sessionId, reviewId, findingId, id);
    const runs = this.runs(attempt.runs);
    if (this.busy.has(id) || this.running(sessionId, runs) || runs.length >= 20)
      throw new AppError(
        'Wait for the active operation or start a new attempt when its history is full.',
        409,
      );
    this.busy.add(id);
    try {
      const target = await this.reviews.verificationTarget(sessionId, review.scope);
      const check = await this.checks.start(sessionId, target, body);
      this.append(id, { kind: 'check', id: check.id, reviewId: target });
      this.notify(sessionId);
      return check;
    } finally {
      this.busy.delete(id);
    }
  }
  async review(sessionId: string, reviewId: string, findingId: string, id: string) {
    const { review, attempt } = this.owned(sessionId, reviewId, findingId, id);
    const runs = this.runs(attempt.runs);
    if (this.busy.has(id) || this.running(sessionId, runs) || runs.length >= 20)
      throw new AppError(
        'Wait for the active operation or start a new attempt when its history is full.',
        409,
      );
    const checkRun = runs.findLast((run) => run.kind === 'check');
    const after = this.check(sessionId, checkRun);
    if (
      !after ||
      !['passed', 'failed'].includes(after.status) ||
      after.signal ||
      after.revisionState !== 'unchanged'
    )
      throw new AppError('Complete a stable verification check before the follow-up review.', 409);
    this.busy.add(id);
    try {
      const current = await this.snapshot(sessionId, review.scope);
      const target = this.db
        .select()
        .from(codeReviews)
        .where(eq(codeReviews.id, after.reviewId))
        .get();
      if (
        !target ||
        target.fromRevision !== current.from ||
        target.toRevision !== current.capture.current
      )
        throw new AppError(
          'Code changed after the check. Run the selected check again before reviewing.',
          409,
        );
      const next = await this.reviews.start(sessionId, {
        scope: review.scope,
        evidenceReviewId: after.reviewId,
      });
      this.append(id, { kind: 'review', id: next.id, reviewId: next.id });
      this.notify(sessionId);
      return next;
    } finally {
      this.busy.delete(id);
    }
  }
  async list(sessionId: string, reviewId: string, findingId: string, beforeId?: string) {
    const { review } = this.source(sessionId, reviewId, findingId);
    const cursor = beforeId ? this.owned(sessionId, reviewId, findingId, beforeId).attempt : null;
    const rows = this.db
      .select()
      .from(reviewFixAttempts)
      .where(
        and(
          eq(reviewFixAttempts.findingId, findingId),
          cursor
            ? or(
                lt(reviewFixAttempts.createdAt, cursor.createdAt),
                and(
                  eq(reviewFixAttempts.createdAt, cursor.createdAt),
                  lt(reviewFixAttempts.id, cursor.id),
                ),
              )
            : undefined,
        ),
      )
      .orderBy(desc(reviewFixAttempts.createdAt), desc(reviewFixAttempts.id))
      .limit(11)
      .all();
    const current = await this.snapshot(sessionId, review.scope).catch(() => null);
    const proof = this.checks.states([reviewId]).findings.get(findingId);
    const attempts = rows.slice(0, 10).map((attempt) => {
      const runs = this.runs(attempt.runs);
      const latestCheck = runs.findLast((run) => run.kind === 'check');
      const after = this.check(sessionId, latestCheck);
      const baseline = attempt.beforeCheckId
        ? this.check(sessionId, { kind: 'check', id: attempt.beforeCheckId, reviewId })
        : null;
      const following = runs.findLast((run) => run.kind === 'review');
      const follow = following
        ? this.db
            .select()
            .from(codeReviews)
            .where(and(eq(codeReviews.id, following.id), eq(codeReviews.sessionId, sessionId)))
            .get()
        : null;
      const target = after
        ? this.db.select().from(codeReviews).where(eq(codeReviews.id, after.reviewId)).get()
        : null;
      const findings = follow
        ? this.db
            .select({ id: codeReviewFindings.id })
            .from(codeReviewFindings)
            .where(eq(codeReviewFindings.reviewId, follow.id))
            .all().length
        : 0;
      const freshness: ReviewFix['freshness'] = !current
        ? 'unknown'
        : target &&
            target.fromRevision === current.from &&
            target.toRevision === current.capture.current
          ? 'current'
          : 'outdated';
      let outcome: ReviewFix['outcome'] = 'not_checked';
      let reason =
        'Run a selected verification command after the code changes. Resolution remains manual.';
      const comparable =
        baseline &&
        after &&
        !baseline.commandRedacted &&
        !after.commandRedacted &&
        baseline.command === after.command &&
        baseline.cwd === after.cwd &&
        baseline.status === 'failed' &&
        baseline.exitCode !== null &&
        baseline.exitCode !== 0 &&
        !baseline.signal &&
        baseline.revisionState === 'unchanged' &&
        baseline.checkedRevision === attempt.requestRevision &&
        baseline.afterRevision === attempt.requestRevision &&
        proof?.state === 'reproduced' &&
        proof.checkId === baseline.id;
      if (after) {
        outcome = 'needs_investigation';
        reason = 'Check results require investigation; no finding status has been changed.';
        if (['pending', 'running'].includes(after.status)) {
          outcome = 'checking';
          reason = 'The selected verification command is running.';
        } else if (freshness !== 'current' || after.revisionState !== 'unchanged')
          reason =
            'The checked code is outdated or could not be verified. Run the check on the current revision.';
        else if (!comparable)
          reason =
            'A comparable, human-confirmed failing baseline on the request revision is missing. Inspect both results.';
        else if (
          after.status === 'failed' &&
          after.exitCode !== null &&
          after.exitCode !== 0 &&
          !after.signal
        ) {
          outcome = 'still_failing';
          reason =
            'The selected reproduction command still fails. Inspect output to establish whether it is the same failure.';
        } else if (after.status === 'passed' && after.exitCode === 0 && !after.signal) {
          if (attempt.requestRevision === after.checkedRevision)
            reason =
              'No source revision change was recorded. A passing check alone does not establish a fix.';
          else if (follow?.status === 'running') {
            outcome = 'reviewing';
            reason = 'The fresh independent review is running.';
          } else if (
            follow?.status === 'completed' &&
            follow.fromRevision === target?.fromRevision &&
            follow.toRevision === target?.toRevision &&
            JSON.parse(follow.evidenceCheckIds ?? '[]').includes(after.id) &&
            !findings
          ) {
            outcome = 'suggested_fixed';
            reason =
              'A confirmed failing baseline now passes on changed code, and the matching independent review reported no findings. Inspect the evidence and decide the final resolution manually.';
          } else
            reason =
              'A completed matching independent review with this check evidence is still required, or it reported findings.';
        }
      }
      if (follow?.status === 'running') {
        outcome = 'reviewing';
        reason = 'The fresh independent review is running.';
      }
      const event = this.db
        .select({ id: sessionEvents.id })
        .from(sessionEvents)
        .where(
          and(
            eq(sessionEvents.sessionId, sessionId),
            eq(sessionEvents.type, 'text'),
            sql`json_extract(${sessionEvents.data}, '$.role') = 'user'`,
            sql`instr(coalesce(json_extract(${sessionEvents.data}, '$.content'), json_extract(${sessionEvents.data}, '$.text'), ''), ${`[AgentCtl fix attempt: ${attempt.id}]`}) > 0`,
          ),
        )
        .limit(1)
        .get();
      return reviewFixSchema.parse({
        id: attempt.id,
        reviewId,
        findingId,
        requestRevision: attempt.requestRevision,
        beforeCheckId: attempt.beforeCheckId,
        createdAt: attempt.createdAt,
        requestEventId: event?.id ?? null,
        before: baseline,
        after,
        runs,
        followup: follow
          ? {
              id: follow.id,
              status: follow.status,
              providerId: follow.providerId,
              modelId: follow.modelId,
              summary: follow.summary,
              error: follow.error,
              fromRevision: follow.fromRevision,
              toRevision: follow.toRevision,
              findings,
            }
          : null,
        outcome,
        reason,
        freshness,
      });
    });
    return { attempts, nextCursor: rows.length > 10 ? rows[9].id : null };
  }
}
