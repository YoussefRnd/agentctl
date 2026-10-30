import type { ReviewVerificationService } from './review-verification-service.js';
import {
  collectReviewHistory,
  savedReviewFiles,
  savedFindingContinuity,
} from './review-continuity.js';
import { randomUUID } from 'node:crypto';
import { and, desc, eq, getTableColumns, inArray, sql, lt, or } from 'drizzle-orm';
import {
  buildCodeReviewPrompt,
  buildReviewHandoffPrompt,
  reviewHandoffSources,
  reviewFindingFingerprint,
  matchReviewFinding,
  reviewCapturedChanges,
  redactAgentErrorText,
  type AgentDriver,
} from '@agentctl/core';
import {
  codeReviews,
  codeReviewFindings,
  sessions,
  sessionEvents,
  type DbClient,
} from '@agentctl/core/db';
import type { ProviderRegistry } from '@agentctl/core/providers';
import { collectReviewContext, type RepositoryService } from '@agentctl/core/repository';
import {
  canMutateWorkspace,
  reviewWalkthroughSchema,
  walkthroughProgressSchema,
  updateWalkthroughProgressSchema,
  type UpdateWalkthroughProgress,
  prepareReviewHandoffSchema,
  type PrepareReviewHandoff,
  type ReviewHandoff,
  type ReviewExecutionEvidence,
  findAgentConfigOption,
  resolveReviewFindingSchema,
  codeReviewRunSchema,
  reviewContextReportSchema,
  type CodeReviewRun,
  type ReviewPriorFinding,
  reviewContinuityReportSchema,
  type StartCodeReview,
  type ResolveReviewFinding,
  type ReviewFile,
  type ReviewContextReport,
} from '@agentctl/shared';
import { AppError } from '../errors/app-error.js';
import type { EventBus } from '../utils/event-bus.js';

/** App-scoped owner of independent reviews, persistence, cancellation and restart recovery. */
export class CodeReviewService {
  private readonly active = new Map<string, { controller: AbortController; task: Promise<void> }>();
  private readonly reviewingSessions = new Set<string>();
  private closing = false;
  constructor(
    private readonly db: DbClient,
    private readonly repositories: Pick<RepositoryService, 'open'>,
    private readonly providers: Pick<ProviderRegistry, 'getProvider' | 'ensureProviderReady'>,
    private readonly driver: AgentDriver,
    private readonly events: Pick<EventBus, 'publishState'>,
    private readonly verification?: Pick<
      ReviewVerificationService,
      'states' | 'promptEvidence' | 'isWorkspaceBusy' | 'get'
    >,
  ) {
    db.update(codeReviews)
      .set({
        status: 'failed',
        error: 'Review interrupted by an app restart. Run it again.',
        finishedAt: Date.now(),
      })
      .where(eq(codeReviews.status, 'running'))
      .run();
  }
  private notify(sessionId: string) {
    this.events.publishState({ topics: ['workspace'], sessionId });
  }
  private async context(sessionId: string) {
    const session = await this.db.query.sessions.findFirst({ where: eq(sessions.id, sessionId) });
    if (!session) throw new AppError('Session not found', 404);
    const repository = await this.repositories.open(session.worktreePath);
    return { session, repository };
  }
  private async capture(sessionId: string) {
    const { session, repository } = await this.context(sessionId);
    if (!repository.info.capabilities.review || !repository.info.capabilities.checkpoints)
      throw new AppError('AI review requires a workspace with revision snapshots.', 400);
    const baseline =
      session.baseCommit === 'none'
        ? undefined
        : await repository.importRevision(session.baseCommit);
    const review = await repository.review(baseline, { includeDiffs: false });
    if (!review.capture) throw new AppError('This workspace cannot capture review revisions.', 400);
    return { session, repository, review, capture: review.capture };
  }
  async list(
    sessionId: string,
    before?: string,
  ): Promise<{ runs: CodeReviewRun[]; nextCursor: string | null }> {
    // Missing/unavailable workspaces retain their saved findings, with freshness unknown.
    const session = await this.db.query.sessions.findFirst({ where: eq(sessions.id, sessionId) });
    if (!session) throw new AppError('Session not found', 404);
    const cursor = before ? this.ownedRun(sessionId, before) : undefined;
    const { capturedFiles: _capturedFiles, ...columns } = getTableColumns(codeReviews);
    const page = this.db
      .select(columns)
      .from(codeReviews)
      .where(
        and(
          eq(codeReviews.sessionId, sessionId),
          cursor
            ? or(
                lt(codeReviews.startedAt, cursor.startedAt),
                and(eq(codeReviews.startedAt, cursor.startedAt), lt(codeReviews.id, cursor.id)),
              )
            : undefined,
        ),
      )
      .orderBy(desc(codeReviews.startedAt), desc(codeReviews.id))
      .limit(21)
      .all();
    const rows = page.slice(0, 20);
    const nextCursor = page.length > 20 ? rows.at(-1)!.id : null;
    if (!rows.length) return { runs: [], nextCursor: null };
    const current = await this.capture(sessionId).catch(() => undefined);
    const findings = this.db
      .select()
      .from(codeReviewFindings)
      .where(
        inArray(
          codeReviewFindings.reviewId,
          rows.map((row) => row.id),
        ),
      )
      .all();
    const verification = this.verification?.states(rows.map((row) => row.id));
    return {
      nextCursor,
      runs: rows.map((row) =>
        codeReviewRunSchema.parse({
          ...row,
          context: this.savedContext(row.context),
          walkthrough: this.savedWalkthrough(row.walkthrough),
          walkthroughProgress: this.savedProgress(row.walkthroughProgress),
          continuity: this.savedContinuityReport(row.continuity),
          evidenceCheckIds: this.savedEvidenceIds(row.evidenceCheckIds),
          verificationSummary: verification?.summaries.get(row.id) ?? {
            total: 0,
            running: 0,
            passed: 0,
            failed: 0,
          },
          freshness: current
            ? row.toRevision === current.capture.current &&
              row.fromRevision ===
                (row.scope === 'session' ? current.capture.baseline : current.capture.working)
              ? 'current'
              : 'outdated'
            : 'unknown',
          findings: findings
            .filter((finding) => finding.reviewId === row.id)
            .map((finding) => ({
              ...finding,
              continuity: savedFindingContinuity(finding.continuity),
              verification: verification?.findings.get(finding.id) ?? {
                state: 'suspected',
                checkId: null,
                reason: null,
                confirmedAt: null,
              },
            })),
        }),
      ),
    };
  }
  async start(sessionId: string, request: StartCodeReview) {
    if (this.closing) throw new AppError('The app is shutting down.', 409);
    if (this.reviewingSessions.has(sessionId))
      throw new AppError('A review is already running for this session.', 409);
    this.reviewingSessions.add(sessionId);
    let started = false;
    try {
      const { session, repository, capture, review } = await this.capture(sessionId);
      if (this.verification?.isWorkspaceBusy(repository.info.workspacePath))
        throw new AppError('Wait for the verification check to finish before reviewing.', 409);
      if (review.files.some((file) => file.state === 'conflicted'))
        throw new AppError('Resolve conflicts before reviewing changes.', 400);
      if (!canMutateWorkspace(session.status))
        throw new AppError('Stop the active turn before starting a review.', 400);
      const providerId = request.providerId ?? session.selectedProvider;
      const provider = this.providers.getProvider(providerId);
      const discovery = provider?.toDiscovery();
      if (!provider?.isInstalled || !discovery?.enabled || discovery.hidden)
        throw new AppError('Choose an enabled, installed ACP provider for review.', 400);
      const modelId =
        request.modelId ??
        (request.providerId
          ? provider.resolveDefaultSelection().selectedModel
          : session.selectedModel);
      const choices = findAgentConfigOption(discovery.configOptions, 'model')?.options ?? [];
      if (
        request.modelId &&
        request.modelId !== 'default' &&
        choices.length &&
        !choices.some((model) => model.value === request.modelId) &&
        !discovery.customModels?.some((model) => model.id === request.modelId)
      )
        throw new AppError(
          'Choose an available model or configure a custom model for this provider.',
          400,
        );
      const fromRevision = request.scope === 'session' ? capture.baseline : capture.working;
      const comparison = await repository.compare(fromRevision, capture.current);
      if (comparison.files.length > 100)
        throw new AppError('Too many files for one review. Review a smaller set of changes.', 400);
      const files: ReviewFile[] = [];
      let size = 0;
      for (const file of comparison.files) {
        const diff = await repository.diff(fromRevision, capture.current, file.path);
        for (const entry of diff) {
          size += entry.diff.length;
          if (size > 60_000)
            throw new AppError(
              'The changes are too large for one review. Review a smaller set of changes.',
              400,
            );
          files.push(entry);
        }
      }
      const messages = this.db
        .select({ data: sessionEvents.data })
        .from(sessionEvents)
        .where(
          and(
            eq(sessionEvents.sessionId, sessionId),
            eq(sessionEvents.type, 'text'),
            sql`json_extract(${sessionEvents.data}, '$.role') = 'user'`,
          ),
        )
        .orderBy(sessionEvents.id)
        .limit(1)
        .all();
      let intent = session.title;
      if (messages[0]) {
        const value: unknown = JSON.parse(messages[0].data);
        if (value && typeof value === 'object') {
          const content =
            'content' in value && typeof value.content === 'string'
              ? value.content
              : 'text' in value && typeof value.text === 'string'
                ? value.text
                : '';
          intent += '\n' + content;
        }
      }
      // Capacity hints affect size only; every provider receives the same plain-text contract.
      const modelWindow =
        choices.find((model) => model.value === modelId)?.contextWindow ??
        discovery.customModels?.find((model) => model.id === modelId)?.contextWindow;
      if (modelWindow && modelWindow < 4096)
        throw new AppError('Choose a model with a larger context window for code review.', 400);
      const maxCharacters = modelWindow ? Math.min(60_000, Math.floor(modelWindow * 1.5)) : 60_000;
      const evidence =
        request.evidenceReviewId && this.verification
          ? this.verification.promptEvidence(
              sessionId,
              request.evidenceReviewId,
              fromRevision,
              capture.current,
            )
          : [];
      const initialPrompt = buildCodeReviewPrompt(
        files,
        intent,
        '',
        undefined,
        maxCharacters,
        evidence,
      );
      const { history, report: continuityReport } = collectReviewHistory(
        this.db,
        sessionId,
        request.scope,
        files,
        fromRevision,
        capture.current,
        Math.min(10000, Math.max(0, maxCharacters - initialPrompt.length - 2500)),
        this.verification,
      );
      const basePrompt = buildCodeReviewPrompt(
        files,
        intent,
        '',
        undefined,
        maxCharacters,
        evidence,
        history,
      );
      const prepareContext = async (signal: AbortSignal) => {
        if (signal.aborted) throw new Error('Review cancelled.');
        const contextSignal = AbortSignal.any([signal, AbortSignal.timeout(15_000)]);
        const readers = await Promise.allSettled([
          repository.textSnapshot(capture.current),
          repository.textSnapshot(fromRevision),
        ]);
        const context = await collectReviewContext({
          current: readers[0].status === 'fulfilled' ? readers[0].value : null,
          before: readers[1].status === 'fulfilled' ? readers[1].value : null,
          files,
          signal: contextSignal,
          maxCharacters: Math.min(40_000, Math.max(0, maxCharacters - basePrompt.length - 1500)),
        });
        const prompt = buildCodeReviewPrompt(
          files,
          intent,
          '',
          context,
          maxCharacters,
          evidence,
          history,
        );
        context.report.inputCharacters = prompt.length;
        return { prompt, report: context.report };
      };
      if (this.closing) throw new AppError('The app is shutting down.', 409);
      const id = randomUUID();
      const controller = new AbortController();
      this.db
        .insert(codeReviews)
        .values({
          id,
          sessionId,
          providerId,
          modelId,
          scope: request.scope,
          fromRevision,
          toRevision: capture.current,
          evidenceCheckIds: JSON.stringify(evidence.map((check) => check.checkId)),
          capturedFiles: JSON.stringify(
            files.map(({ path, state, diff }) => ({ path, state, diff })),
          ),
          continuity: JSON.stringify(continuityReport),
          status: 'running',
          startedAt: Date.now(),
        })
        .run();
      const task = this.execute(
        id,
        sessionId,
        providerId,
        modelId,
        prepareContext,
        files,
        history,
        controller.signal,
      );
      this.active.set(id, { controller, task });
      void task.catch(() => undefined); // Shutdown still awaits every owned task.
      started = true;
      this.notify(sessionId);
      return { id };
    } finally {
      if (!started) this.reviewingSessions.delete(sessionId);
    }
  }
  private async awaitReadiness(providerId: string, signal: AbortSignal) {
    let abort: (() => void) | undefined;
    try {
      return await Promise.race([
        this.providers.ensureProviderReady(providerId, { force: false }),
        new Promise<never>((_, reject) => {
          abort = () => reject(new Error('Review cancelled.'));
          signal.addEventListener('abort', abort, { once: true });
          if (signal.aborted) abort();
        }),
      ]);
    } finally {
      if (abort) signal.removeEventListener('abort', abort);
    }
  }
  private async execute(
    id: string,
    sessionId: string,
    providerId: string,
    modelId: string,
    prepareContext: (
      signal: AbortSignal,
    ) => Promise<{ prompt: string; report: ReviewContextReport }>,
    files: ReviewFile[],
    history: ReviewPriorFinding[],
    signal: AbortSignal,
  ) {
    let environment: Record<string, string> = {};
    try {
      // Preparation failures can contain profile-specific secrets before readiness returns.
      const configured = this.providers.getProvider(providerId);
      if (configured)
        environment = configured.getLaunchConfig(
          modelId,
          configured.resolveDefaultSelection().selectedThinkingEffort,
        ).env;
      const { prompt, report } = await prepareContext(signal);
      if (signal.aborted) throw new Error('Review cancelled.');
      this.db
        .update(codeReviews)
        .set({ context: JSON.stringify(report) })
        .where(and(eq(codeReviews.id, id), eq(codeReviews.status, 'running')))
        .run();
      const provider = await this.awaitReadiness(providerId, signal);
      if (signal.aborted) throw new Error('Review cancelled.');
      if (!provider.isReady || !provider.toDiscovery().enabled || provider.toDiscovery().hidden)
        throw new Error(
          'Connect the selected provider in Settings → AI Providers before reviewing.',
        );
      const effort = provider.resolveDefaultSelection().selectedThinkingEffort;
      const launch = provider.getLaunchConfig(modelId, effort);
      environment = launch.env;
      const result = await reviewCapturedChanges(
        this.driver,
        launch,
        {
          providerId,
          selectedModel: modelId,
          selectedThinkingEffort: effort,
          features: provider.features,
          customModels: provider.toDiscovery().customModels,
        },
        prompt,
        files,
        signal,
      );
      if (signal.aborted) throw new Error('Review cancelled.');
      this.db.transaction((tx) => {
        const row = tx
          .select()
          .from(codeReviews)
          .where(and(eq(codeReviews.id, id), eq(codeReviews.status, 'running')))
          .get();
        if (!row) return; // Session deleted or cancellation won the race.
        if (result.findings.length)
          tx.insert(codeReviewFindings)
            .values(
              result.findings.map(({ previousFindingId, ...finding }) => {
                const fingerprint = reviewFindingFingerprint(
                  finding,
                  files.find((file) => file.path === finding.path),
                );
                const continuity = matchReviewFinding(
                  { ...finding, previousFindingId },
                  fingerprint,
                  history,
                );
                return {
                  ...finding,
                  id: randomUUID(),
                  reviewId: id,
                  status: 'open' as const,
                  fingerprint,
                  continuity: continuity ? JSON.stringify(continuity) : null,
                };
              }),
            )
            .run();
        tx.update(codeReviews)
          .set({
            status: 'completed',
            summary: result.summary,
            walkthrough: result.walkthrough ? JSON.stringify(result.walkthrough) : null,
            finishedAt: Date.now(),
          })
          .where(eq(codeReviews.id, id))
          .run();
      });
    } catch (error) {
      this.db
        .update(codeReviews)
        .set({
          status: signal.aborted ? 'cancelled' : 'failed',
          error: signal.aborted
            ? 'Review cancelled.'
            : redactAgentErrorText(error instanceof Error ? error.message : String(error), {
                ...process.env,
                ...environment,
              }).slice(0, 2000),
          finishedAt: Date.now(),
        })
        .where(and(eq(codeReviews.id, id), eq(codeReviews.status, 'running')))
        .run();
    } finally {
      this.active.delete(id);
      this.reviewingSessions.delete(sessionId);
      this.notify(sessionId);
    }
  }
  private savedContinuityReport(raw: string | null) {
    try {
      return raw ? reviewContinuityReportSchema.parse(JSON.parse(raw)) : null;
    } catch {
      return null;
    }
  }
  async file(sessionId: string, reviewId: string, path: string) {
    const review = this.ownedRun(sessionId, reviewId);
    const saved = savedReviewFiles(review.capturedFiles);
    if (saved) {
      const file = saved.find((file) => file.path === path);
      if (!file) throw new AppError('File not found in this review', 404);
      return { file, source: 'saved' as const };
    }
    const finding = this.db
      .select({ id: codeReviewFindings.id })
      .from(codeReviewFindings)
      .where(and(eq(codeReviewFindings.reviewId, reviewId), eq(codeReviewFindings.path, path)))
      .get();
    if (!finding) throw new AppError('File not found in this review', 404);
    // Legacy reviews may still have their immutable repository objects. Never read the live file.
    try {
      const { repository } = await this.context(sessionId);
      const file = (await repository.diff(review.fromRevision, review.toRevision, path)).find(
        (file) => file.path === path,
      );
      if (file && file.diff.length <= 60000) return { file, source: 'snapshot' as const };
    } catch {
      /* Saved findings remain usable when their source objects are no longer available. */
    }
    return { file: null, source: 'unavailable' as const };
  }
  async handoff(
    sessionId: string,
    reviewId: string,
    findingId: string,
    input: PrepareReviewHandoff,
  ): Promise<ReviewHandoff> {
    const request = prepareReviewHandoffSchema.parse(input);
    const review = this.ownedRun(sessionId, reviewId);
    const finding = this.db
      .select()
      .from(codeReviewFindings)
      .where(and(eq(codeReviewFindings.id, findingId), eq(codeReviewFindings.reviewId, reviewId)))
      .get();
    if (!finding) throw new AppError('Finding not found', 404);
    if (review.status !== 'completed')
      throw new AppError('Only completed reviews can hand off findings.', 400);
    const session = await this.db.query.sessions.findFirst({ where: eq(sessions.id, sessionId) });
    if (!session) throw new AppError('Session not found', 404);
    const file = (await this.file(sessionId, reviewId, finding.path)).file ?? undefined;
    const current = await this.capture(sessionId).catch(() => undefined);
    const freshness: ReviewHandoff['freshness'] = current
      ? review.fromRevision ===
          (review.scope === 'session' ? current.capture.baseline : current.capture.working) &&
        review.toRevision === current.capture.current
        ? 'current'
        : 'outdated'
      : 'unknown';
    const checkedAt = Date.now();
    const reader = current
      ? await current.repository.textSnapshot(current.capture.current).catch(() => null)
      : null;
    const text = reader
      ? await reader.readFile(finding.path, 128 * 1024, AbortSignal.timeout(5000)).catch(() => null)
      : null;
    const sources = reviewHandoffSources(file, finding.line, text, freshness);
    const verification = this.verification?.states([reviewId]).findings.get(findingId) ?? {
      state: 'suspected' as const,
      checkId: null,
      reason: null,
      confirmedAt: null,
    };
    const continuity = savedFindingContinuity(finding.continuity);
    const checks: Array<ReviewExecutionEvidence & { reviewId: string; appliesToCurrent: boolean }> =
      [];
    const addCheck = (sourceReviewId: string, check: ReviewExecutionEvidence, matches: boolean) => {
      if (!checks.some((entry) => entry.checkId === check.checkId))
        checks.push({ ...check, reviewId: sourceReviewId, appliesToCurrent: matches });
    };
    const linked = [
      { reviewId, verification },
      continuity?.lastEvidence,
      continuity ? { reviewId: continuity.reviewId, verification: continuity.verification } : null,
    ].filter((entry) => entry?.verification.checkId);
    for (const entry of linked) {
      if (!entry?.verification.checkId || !this.verification || checks.length >= 2) continue;
      try {
        const check = this.verification.get(sessionId, entry.reviewId, entry.verification.checkId);
        if (
          !['passed', 'failed'].includes(check.status) ||
          check.exitCode === null ||
          check.finishedAt === null
        )
          continue;
        const source = this.ownedRun(sessionId, entry.reviewId);
        addCheck(
          entry.reviewId,
          {
            checkId: check.id,
            name: check.name,
            command: check.command,
            status: check.status as 'passed' | 'failed',
            exitCode: check.exitCode,
            startedAt: check.startedAt,
            finishedAt: check.finishedAt,
            stdout: check.stdout.slice(-1000),
            stderr: check.stderr.slice(-1000),
            outputTruncated:
              check.outputTruncated || check.stdout.length > 1000 || check.stderr.length > 1000,
          },
          !!current &&
            source.fromRevision ===
              (source.scope === 'session' ? current.capture.baseline : current.capture.working) &&
            source.toRevision === current.capture.current &&
            check.revisionState === 'unchanged',
        );
      } catch {
        /* A missing historical check is not substituted with a provider's claim. */
      }
    }
    for (const check of this.verification?.promptEvidence(
      sessionId,
      reviewId,
      review.fromRevision,
      review.toRevision,
    ) ?? [])
      if (checks.length < 3) addCheck(reviewId, check, freshness === 'current');
    const closed = ['merged', 'discarded', 'archived'].includes(session.status);
    const busy =
      !!current && this.verification?.isWorkspaceBusy(current.repository.info.workspacePath);
    const blockedReason = closed
      ? 'Reactivate this session before adding a request.'
      : request.intent === 'fix' && !canMutateWorkspace(session.status)
        ? 'Stop the active turn before preparing a fix request.'
        : request.intent === 'fix' && (freshness === 'unknown' || busy)
          ? 'A stable workspace snapshot is required before preparing a fix request. Refresh when the workspace is available and checks have stopped.'
          : null;
    const short = (reference: string) =>
      reference.length > 160 ? reference.slice(0, 160) + ' [abbreviated]' : reference;
    const result = buildReviewHandoffPrompt(
      request.intent,
      {
        finding: {
          reviewId,
          findingId,
          path: finding.path,
          reviewedLine: finding.line,
          title: finding.title,
          body: finding.body,
          status: finding.status,
          resolution: finding.resolution,
          verification,
        },
        review: {
          scope: review.scope,
          fromRevision: short(review.fromRevision),
          toRevision: short(review.toRevision),
        },
        observation: {
          freshness,
          checkedAt,
          currentLine: sources.currentLine,
          location: sources.location,
          capture: current
            ? Object.fromEntries(
                Object.entries(current.capture).map(([key, value]) => [key, short(value)]),
              )
            : null,
        },
        sources: { reviewed: sources.reviewed, current: sources.current },
        history: continuity,
        checks,
      },
      request.notes,
    );
    return {
      intent: request.intent,
      freshness,
      checkedAt,
      capture: current?.capture ?? null,
      ...sources,
      canAdd: !blockedReason,
      blockedReason,
      evidenceCount: checks.length,
      ...result,
    };
  }
  private savedWalkthrough(raw: string | null) {
    try {
      return raw ? reviewWalkthroughSchema.parse(JSON.parse(raw)) : null;
    } catch {
      return null;
    }
  }
  private savedProgress(raw: string | null) {
    try {
      return raw ? walkthroughProgressSchema.parse(JSON.parse(raw)) : { position: 0, seen: [] };
    } catch {
      return { position: 0, seen: [] };
    }
  }
  progress(sessionId: string, reviewId: string, input: UpdateWalkthroughProgress) {
    const request = updateWalkthroughProgressSchema.parse(input);
    this.ownedRun(sessionId, reviewId);
    const result = this.db.transaction((tx) => {
      const review = tx
        .select()
        .from(codeReviews)
        .where(and(eq(codeReviews.id, reviewId), eq(codeReviews.sessionId, sessionId)))
        .get();
      if (!review) throw new AppError('Review not found', 404);
      const tour = this.savedWalkthrough(review.walkthrough);
      if (!tour || review.status !== 'completed')
        throw new AppError(
          'This review has no saved walkthrough. Review again to generate one.',
          400,
        );
      if (request.action !== 'reset' && request.position >= tour.length)
        throw new AppError('Walkthrough stop not found', 400);
      const progress = this.savedProgress(review.walkthroughProgress);
      if (request.action === 'reset') {
        progress.position = 0;
        progress.seen = [];
      } else if (request.action === 'navigate') progress.position = request.position;
      else
        progress.seen = request.seen
          ? [...new Set([...progress.seen, request.position])].sort((a, b) => a - b)
          : progress.seen.filter((index) => index !== request.position);
      tx.update(codeReviews)
        .set({ walkthroughProgress: JSON.stringify(progress) })
        .where(eq(codeReviews.id, reviewId))
        .run();
      return progress;
    });
    this.notify(sessionId);
    return result;
  }
  async walkthroughQuestion(sessionId: string, reviewId: string, position: number) {
    const review = this.ownedRun(sessionId, reviewId);
    const tour = this.savedWalkthrough(review.walkthrough);
    const stop = tour?.[position];
    if (!stop || review.status !== 'completed')
      throw new AppError('Walkthrough stop not found', 400);
    const session = await this.db.query.sessions.findFirst({ where: eq(sessions.id, sessionId) });
    if (!session || ['merged', 'discarded', 'archived'].includes(session.status))
      throw new AppError('Reactivate this session before asking about a section.', 400);
    const current = await this.capture(sessionId).catch(() => undefined);
    const freshness = current
      ? review.toRevision === current.capture.current &&
        review.fromRevision ===
          (review.scope === 'session' ? current.capture.baseline : current.capture.working)
        ? ('current' as const)
        : ('outdated' as const)
      : ('unknown' as const);
    const sources = [];
    for (const anchor of stop.excerpts.slice(0, 3)) {
      const file = (await this.file(sessionId, reviewId, anchor.path)).file;
      sources.push({
        path: anchor.path,
        ...reviewHandoffSources(
          file ? { ...file, state: anchor.side === 'old' ? 'deleted' : 'modified' } : undefined,
          anchor.line,
          null,
          freshness,
        ).reviewed,
      });
    }
    const findings = this.db
      .select()
      .from(codeReviewFindings)
      .where(eq(codeReviewFindings.reviewId, reviewId))
      .all()
      .filter((finding) =>
        [...stop.files, ...stop.excerpts.map((anchor) => anchor.path)].includes(finding.path),
      )
      .slice(0, 6);
    const checks = (
      this.verification?.promptEvidence(
        sessionId,
        reviewId,
        review.fromRevision,
        review.toRevision,
      ) ?? []
    )
      .slice(0, 2)
      .map((check) => ({ ...check, appliesToCurrent: freshness === 'current' }));
    const result = buildReviewHandoffPrompt(
      'ask',
      {
        finding: { path: stop.excerpts[0]?.path ?? stop.files[0] ?? '', body: stop.summary },
        history: {
          section: stop.title,
          findings: findings.map(({ title, body, path, line, status, resolution }) => ({
            title,
            body,
            path,
            line,
            status,
            resolution,
          })),
        },
        checks,
        sources,
        observation: { freshness, checkedAt: Date.now() },
      },
      'Explain this walkthrough section, its purpose and how its parts connect. Distinguish the captured version from current code. Context includes at most three captured excerpt anchors, six related findings and two review-wide check results; do not assume full section coverage.',
    );
    return { prompt: result.prompt, freshness, capture: current?.capture ?? null };
  }
  private savedEvidenceIds(raw: string | null) {
    try {
      const value: unknown = JSON.parse(raw ?? '[]');
      return Array.isArray(value)
        ? value.filter((id): id is string => typeof id === 'string').slice(0, 5)
        : [];
    } catch {
      return [];
    }
  }
  private savedContext(raw: string | null) {
    if (!raw) return null;
    try {
      return reviewContextReportSchema.parse(JSON.parse(raw));
    } catch {
      return null;
    }
  }
  private ownedRun(sessionId: string, reviewId: string) {
    const row = this.db
      .select()
      .from(codeReviews)
      .where(and(eq(codeReviews.id, reviewId), eq(codeReviews.sessionId, sessionId)))
      .get();
    if (!row) throw new AppError('Review not found', 404);
    return row;
  }
  cancel(sessionId: string, reviewId: string) {
    const row = this.ownedRun(sessionId, reviewId);
    if (row.status === 'running') {
      this.db
        .update(codeReviews)
        .set({ status: 'cancelled', error: 'Review cancelled.', finishedAt: Date.now() })
        .where(eq(codeReviews.id, reviewId))
        .run();
      this.active.get(reviewId)?.controller.abort();
      this.notify(sessionId);
    }
    return { success: true };
  }
  resolve(sessionId: string, reviewId: string, findingId: string, request: ResolveReviewFinding) {
    request = resolveReviewFindingSchema.parse(request);
    this.ownedRun(sessionId, reviewId);
    const finding = this.db
      .select()
      .from(codeReviewFindings)
      .where(and(eq(codeReviewFindings.id, findingId), eq(codeReviewFindings.reviewId, reviewId)))
      .get();
    if (!finding) throw new AppError('Finding not found', 404);
    const continuity = savedFindingContinuity(finding.continuity);
    this.db
      .update(codeReviewFindings)
      .set({
        ...(request.status === 'open' && continuity
          ? { continuity: JSON.stringify({ ...continuity, lastDecision: null }) }
          : {}),
        status: request.status,
        resolution: request.status === 'open' ? null : (request.resolution ?? null),
      })
      .where(eq(codeReviewFindings.id, findingId))
      .run();
    this.notify(sessionId);
    return { success: true };
  }
  async dispose() {
    this.closing = true;
    for (const job of this.active.values()) job.controller.abort();
    await Promise.allSettled([...this.active.values()].map((job) => job.task));
  }
}
