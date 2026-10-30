import { randomUUID } from 'node:crypto';
import { and, desc, eq, inArray, lt, or } from 'drizzle-orm';
import {
  executeReviewCheck,
  scrubReviewCheckText,
  type ReviewCheckExecution,
} from '@agentctl/core';
import {
  codeReviews,
  codeReviewFindings,
  reviewChecks,
  reviewFindingEvidence,
  sessions,
  type DbClient,
} from '@agentctl/core/db';
import type { RepositoryService } from '@agentctl/core/repository';
import type { SessionManager } from '@agentctl/core/session';
import {
  canMutateWorkspace,
  runReviewCheckSchema,
  confirmFindingEvidenceSchema,
  reviewCheckSummarySchema,
  reviewCheckResultSchema,
  type RunReviewCheck,
  type ConfirmFindingEvidence,
  type FindingVerification,
  type VerificationSummary,
  type ReviewExecutionEvidence,
} from '@agentctl/shared';
import type { EventBus } from '../utils/event-bus.js';
import { AppError } from '../errors/app-error.js';

type ReviewRow = typeof codeReviews.$inferSelect;
/** Owns explicit local checks and human-confirmed evidence. Never calls an AI provider. */
export class ReviewVerificationService {
  private active = new Map<
    string,
    { sessionId: string; workspace: string; controller: AbortController; task: Promise<void> }
  >();
  private reserved = new Set<string>();
  private closing = false;
  constructor(
    private readonly db: DbClient,
    private readonly repositories: Pick<RepositoryService, 'open'>,
    private readonly manager: Pick<SessionManager, 'runWorkspaceCommand'>,
    private readonly events: Pick<EventBus, 'publishState'>,
    private readonly runner = executeReviewCheck,
  ) {
    db.update(reviewChecks)
      .set({
        status: 'interrupted',
        error: 'Check interrupted by an app restart. Run it again.',
        finishedAt: Date.now(),
        revisionState: 'unknown',
      })
      .where(inArray(reviewChecks.status, ['pending', 'running']))
      .run();
  }
  private notify(sessionId: string) {
    this.events.publishState({ topics: ['workspace'], sessionId });
  }
  private ownedReview(sessionId: string, reviewId: string) {
    const review = this.db
      .select()
      .from(codeReviews)
      .where(and(eq(codeReviews.id, reviewId), eq(codeReviews.sessionId, sessionId)))
      .get();
    if (!review) throw new AppError('Review not found', 404);
    return review;
  }
  private ownedCheck(sessionId: string, reviewId: string, checkId: string) {
    this.ownedReview(sessionId, reviewId);
    const check = this.db
      .select()
      .from(reviewChecks)
      .where(and(eq(reviewChecks.id, checkId), eq(reviewChecks.reviewId, reviewId)))
      .get();
    if (!check) throw new AppError('Check not found', 404);
    return check;
  }
  private async snapshot(sessionId: string) {
    const session = await this.db.query.sessions.findFirst({ where: eq(sessions.id, sessionId) });
    if (!session) throw new AppError('Session not found', 404);
    const repository = await this.repositories.open(session.worktreePath);
    const base =
      session.baseCommit === 'none'
        ? undefined
        : await repository.importRevision(session.baseCommit);
    const review = await repository.review(base, { includeDiffs: false });
    if (!review.capture) throw new AppError('Verification requires revision snapshots.', 400);
    return { session, workspace: repository.info.workspacePath, capture: review.capture };
  }
  private matches(
    review: ReviewRow,
    current: Awaited<ReturnType<ReviewVerificationService['snapshot']>>,
  ) {
    return (
      review.toRevision === current.capture.current &&
      review.fromRevision ===
        (review.scope === 'session' ? current.capture.baseline : current.capture.working)
    );
  }
  isWorkspaceBusy(workspace: string) {
    return this.reserved.has(workspace);
  }
  async start(sessionId: string, reviewId: string, input: RunReviewCheck) {
    const request = runReviewCheckSchema.parse(input);
    if (this.closing) throw new AppError('The app is shutting down.', 409);
    if (this.active.size >= 4)
      throw new AppError('Wait for a running verification check to finish.', 409);
    const review = this.ownedReview(sessionId, reviewId);
    if (review.status !== 'completed')
      throw new AppError('Complete an AI review before running its checks.', 400);
    const current = await this.snapshot(sessionId);
    if (!canMutateWorkspace(current.session.status))
      throw new AppError('Stop the active turn before running a check.', 409);
    if (!this.matches(review, current))
      throw new AppError(
        'This review is outdated. Review the current changes before running a check.',
        409,
      );
    if (this.closing) throw new AppError('The app is shutting down.', 409);
    if (this.active.size >= 4)
      throw new AppError('Wait for a running verification check to finish.', 409);
    if (this.reserved.has(current.workspace))
      throw new AppError('A verification check is already running in this workspace.', 409);
    this.reserved.add(current.workspace);
    const controller = new AbortController();
    const id = randomUUID();
    try {
      const displayCommand = scrubReviewCheckText(request.command);
      this.db
        .insert(reviewChecks)
        .values({
          id,
          reviewId,
          name: scrubReviewCheckText(request.name || displayCommand.split('\n')[0].slice(0, 100)),
          command: displayCommand,
          commandRedacted: displayCommand !== request.command,
          status: 'pending',
          cwd: current.workspace,
          timeoutMs: request.timeoutMs,
          expectedRevision: review.toRevision,
          startedAt: Date.now(),
        })
        .run();
      const task = this.execute(
        id,
        sessionId,
        review,
        request,
        current.workspace,
        controller.signal,
      );
      this.active.set(id, { sessionId, workspace: current.workspace, controller, task });
      void task.catch(() => undefined);
      this.notify(sessionId);
      return { id };
    } catch (error) {
      this.reserved.delete(current.workspace);
      throw error;
    }
  }
  private async execute(
    id: string,
    sessionId: string,
    review: ReviewRow,
    request: RunReviewCheck,
    workspace: string,
    signal: AbortSignal,
  ) {
    let flush: ReturnType<typeof setTimeout> | undefined;
    let latest: { stdout: string; stderr: string; outputTruncated: boolean } | undefined;
    const persist = () => {
      flush = undefined;
      if (latest)
        this.db
          .update(reviewChecks)
          .set(latest)
          .where(and(eq(reviewChecks.id, id), eq(reviewChecks.status, 'running')))
          .run();
    };
    let entered = false;
    let abortQueued: (() => void) | undefined;
    const cancelledWhileQueued = new Promise<never>((_, reject) => {
      abortQueued = () => {
        if (!entered) reject(new Error('Check cancelled.'));
      };
      signal.addEventListener('abort', abortQueued, { once: true });
      if (signal.aborted) abortQueued();
    });
    try {
      const operation = this.manager.runWorkspaceCommand(
        sessionId,
        { action: 'review.check', reviewId: review.id, checkId: id },
        async () => {
          entered = true;
          if (signal.aborted) throw new Error('Check cancelled.');
          const before = await this.snapshot(sessionId);
          if (
            !canMutateWorkspace(before.session.status) ||
            before.workspace !== workspace ||
            !this.matches(review, before)
          )
            throw new Error(
              'The workspace changed before this check could start. Review the current changes and try again.',
            );
          this.db
            .update(reviewChecks)
            .set({ status: 'running', checkedRevision: before.capture.current })
            .where(and(eq(reviewChecks.id, id), eq(reviewChecks.status, 'pending')))
            .run();
          if (signal.aborted) throw new Error('Check cancelled.');
          this.notify(sessionId);
          const result: ReviewCheckExecution = await this.runner(
            request.command,
            workspace,
            request.timeoutMs,
            signal,
            (output) => {
              latest = output;
              if (!flush)
                flush = setTimeout(() => {
                  try {
                    persist();
                  } catch {
                    /* Final result persistence still reports failures. */
                  }
                }, 500);
            },
          );
          clearTimeout(flush);
          const after = await this.snapshot(sessionId).catch(() => undefined);
          const revisionState = after
            ? this.matches(review, after) && after.workspace === workspace
              ? 'unchanged'
              : 'changed'
            : 'unknown';
          this.db
            .update(reviewChecks)
            .set({
              ...result,
              ...(signal.aborted
                ? { status: 'cancelled' as const, error: 'Check cancelled.' }
                : {}),
              revisionState,
              afterRevision: after?.capture.current ?? null,
              finishedAt: Date.now(),
            })
            .where(
              and(eq(reviewChecks.id, id), inArray(reviewChecks.status, ['pending', 'running'])),
            )
            .run();
        },
      );
      await Promise.race([operation, cancelledWhileQueued]);
    } catch (error) {
      this.db
        .update(reviewChecks)
        .set({
          ...latest,
          status: signal.aborted ? 'cancelled' : 'error',
          error: signal.aborted
            ? 'Check cancelled.'
            : scrubReviewCheckText(error instanceof Error ? error.message : String(error)).slice(
                0,
                2000,
              ),
          finishedAt: Date.now(),
          revisionState: 'unknown',
        })
        .where(and(eq(reviewChecks.id, id), inArray(reviewChecks.status, ['pending', 'running'])))
        .run();
    } finally {
      if (abortQueued) signal.removeEventListener('abort', abortQueued);
      clearTimeout(flush);
      this.active.delete(id);
      this.reserved.delete(workspace);
      this.notify(sessionId);
    }
  }
  list(sessionId: string, reviewId: string, before?: string) {
    this.ownedReview(sessionId, reviewId);
    const cursor = before ? this.ownedCheck(sessionId, reviewId, before) : undefined;
    const rows = this.db
      .select({
        id: reviewChecks.id,
        reviewId: reviewChecks.reviewId,
        name: reviewChecks.name,
        command: reviewChecks.command,
        commandRedacted: reviewChecks.commandRedacted,
        status: reviewChecks.status,
        timeoutMs: reviewChecks.timeoutMs,
        cwd: reviewChecks.cwd,
        expectedRevision: reviewChecks.expectedRevision,
        checkedRevision: reviewChecks.checkedRevision,
        afterRevision: reviewChecks.afterRevision,
        revisionState: reviewChecks.revisionState,
        exitCode: reviewChecks.exitCode,
        signal: reviewChecks.signal,
        error: reviewChecks.error,
        startedAt: reviewChecks.startedAt,
        finishedAt: reviewChecks.finishedAt,
        outputTruncated: reviewChecks.outputTruncated,
      })
      .from(reviewChecks)
      .where(
        and(
          eq(reviewChecks.reviewId, reviewId),
          cursor
            ? or(
                lt(reviewChecks.startedAt, cursor.startedAt),
                and(eq(reviewChecks.startedAt, cursor.startedAt), lt(reviewChecks.id, cursor.id)),
              )
            : undefined,
        ),
      )
      .orderBy(desc(reviewChecks.startedAt), desc(reviewChecks.id))
      .limit(21)
      .all();
    return {
      checks: rows.slice(0, 20).map((row) => reviewCheckSummarySchema.parse(row)),
      nextCursor: rows.length > 20 ? rows[19].id : null,
    };
  }
  get(sessionId: string, reviewId: string, checkId: string) {
    return reviewCheckResultSchema.parse(this.ownedCheck(sessionId, reviewId, checkId));
  }
  cancel(sessionId: string, reviewId: string, checkId: string) {
    const check = this.ownedCheck(sessionId, reviewId, checkId);
    if (check.status === 'pending' || check.status === 'running')
      this.active.get(checkId)?.controller.abort();
    return { success: true };
  }
  cancelSession(sessionId: string) {
    for (const job of this.active.values()) if (job.sessionId === sessionId) job.controller.abort();
  }
  confirm(sessionId: string, reviewId: string, findingId: string, input: ConfirmFindingEvidence) {
    const request = confirmFindingEvidenceSchema.parse(input);
    const review = this.ownedReview(sessionId, reviewId);
    const finding = this.db
      .select()
      .from(codeReviewFindings)
      .where(and(eq(codeReviewFindings.id, findingId), eq(codeReviewFindings.reviewId, reviewId)))
      .get();
    if (!finding) throw new AppError('Finding not found', 404);
    if (request.state === 'reproduced') {
      const check = this.ownedCheck(sessionId, reviewId, request.checkId);
      if (
        check.status !== 'failed' ||
        check.exitCode === null ||
        check.exitCode === 0 ||
        check.signal ||
        check.revisionState !== 'unchanged' ||
        check.expectedRevision !== review.toRevision ||
        check.checkedRevision !== review.toRevision ||
        check.afterRevision !== review.toRevision
      )
        throw new AppError(
          'Reproduction needs a completed failing check that matched this review before and after execution.',
          409,
        );
    }
    this.db.transaction((tx) => {
      const previous = tx
        .select({ createdAt: reviewFindingEvidence.createdAt })
        .from(reviewFindingEvidence)
        .where(eq(reviewFindingEvidence.findingId, findingId))
        .orderBy(desc(reviewFindingEvidence.createdAt))
        .limit(1)
        .get();
      tx.insert(reviewFindingEvidence)
        .values({
          id: randomUUID(),
          findingId,
          checkId: request.state === 'reproduced' ? request.checkId : null,
          state: request.state,
          reason:
            request.state === 'reproduced'
              ? scrubReviewCheckText(request.reason)
              : request.reason
                ? scrubReviewCheckText(request.reason)
                : null,
          createdAt: Math.max(Date.now(), (previous?.createdAt ?? 0) + 1),
        })
        .run();
    });
    this.notify(sessionId);
    return { success: true };
  }
  states(reviewIds: string[]) {
    const summaries = new Map<string, VerificationSummary>();
    const findings = new Map<string, FindingVerification>();
    if (!reviewIds.length) return { summaries, findings };
    const checks = this.db
      .select({
        id: reviewChecks.id,
        reviewId: reviewChecks.reviewId,
        status: reviewChecks.status,
        revisionState: reviewChecks.revisionState,
      })
      .from(reviewChecks)
      .where(inArray(reviewChecks.reviewId, reviewIds))
      .all();
    for (const check of checks) {
      const summary = summaries.get(check.reviewId) ?? {
        total: 0,
        running: 0,
        passed: 0,
        failed: 0,
      };
      summary.total++;
      if (['pending', 'running'].includes(check.status)) summary.running++;
      if (check.status === 'passed') summary.passed++;
      if (check.status === 'failed') summary.failed++;
      summaries.set(check.reviewId, summary);
    }
    const history = this.db
      .select({
        findingId: reviewFindingEvidence.findingId,
        checkId: reviewFindingEvidence.checkId,
        state: reviewFindingEvidence.state,
        reason: reviewFindingEvidence.reason,
        createdAt: reviewFindingEvidence.createdAt,
      })
      .from(reviewFindingEvidence)
      .innerJoin(codeReviewFindings, eq(reviewFindingEvidence.findingId, codeReviewFindings.id))
      .where(inArray(codeReviewFindings.reviewId, reviewIds))
      .orderBy(desc(reviewFindingEvidence.createdAt), desc(reviewFindingEvidence.id))
      .all();
    const eligible = new Set(
      checks
        .filter((check) => check.status === 'failed' && check.revisionState === 'unchanged')
        .map((check) => check.id),
    );
    for (const entry of history)
      if (!findings.has(entry.findingId))
        findings.set(entry.findingId, {
          state:
            entry.state === 'reproduced' && entry.checkId && eligible.has(entry.checkId)
              ? 'reproduced'
              : 'suspected',
          checkId: entry.checkId,
          reason: entry.reason,
          confirmedAt: entry.createdAt,
        });
    return { summaries, findings };
  }
  promptEvidence(
    sessionId: string,
    reviewId: string,
    fromRevision: string,
    toRevision: string,
  ): ReviewExecutionEvidence[] {
    const review = this.ownedReview(sessionId, reviewId);
    if (review.fromRevision !== fromRevision || review.toRevision !== toRevision) return [];
    const rows = this.db
      .select()
      .from(reviewChecks)
      .where(
        and(
          eq(reviewChecks.reviewId, reviewId),
          eq(reviewChecks.revisionState, 'unchanged'),
          inArray(reviewChecks.status, ['passed', 'failed']),
        ),
      )
      .orderBy(desc(reviewChecks.startedAt), desc(reviewChecks.id))
      .limit(5)
      .all();
    const evidence: ReviewExecutionEvidence[] = [];
    for (const row of rows) {
      if (
        row.checkedRevision !== toRevision ||
        row.afterRevision !== toRevision ||
        row.exitCode === null ||
        row.finishedAt === null ||
        row.signal
      )
        continue;
      const entry: ReviewExecutionEvidence = {
        checkId: row.id,
        name: row.name,
        command: row.command,
        status: row.status as 'passed' | 'failed',
        exitCode: row.exitCode,
        startedAt: row.startedAt,
        finishedAt: row.finishedAt,
        stdout: row.stdout.slice(-1500),
        stderr: row.stderr.slice(-1500),
        outputTruncated:
          row.outputTruncated || row.stdout.length > 1500 || row.stderr.length > 1500,
      };
      if (JSON.stringify([...evidence, entry]).length <= 10_000) evidence.push(entry);
    }
    return evidence;
  }
  async dispose() {
    this.closing = true;
    for (const job of this.active.values()) job.controller.abort();
    await Promise.allSettled([...this.active.values()].map((job) => job.task));
  }
}
