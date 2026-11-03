import { CodeReviewWalkthrough } from './CodeReviewWalkthrough';
import type { ReviewComposerActions } from '../model/composer-actions';
import { CodeReviewVerification } from './CodeReviewVerification';
import { CodeReviewContext } from './CodeReviewContext';
import { useId, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button, Spinner } from '@agentctl/ui';
import { providerService } from '@agentctl/api-client';
import {
  AlertIcon,
  CheckCircleIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CodeReviewIcon,
  XIcon,
} from '@primer/octicons-react';
import type { CodeReviewRun, RepositoryCapture, ReviewFinding } from '@agentctl/shared';
import { providerKeys } from '@/shared/lib/queryKeys';
import { useCodeReviews } from '../model/useCodeReviews';
import { CodeReviewFinding } from './CodeReviewFinding';
import {
  CodeReviewOptions,
  CodeReviewHistory,
  reviewScopeLabel,
  reviewTime,
} from './CodeReviewControls';

interface Props {
  composerActions?: ReviewComposerActions;
  sessionId: string;
  capture?: RepositoryCapture;
  disabled?: boolean;
  unavailable?: boolean;
  onSelectFile(path: string, scope: 'working' | 'session'): void;
}
const severityOrder = { high: 0, medium: 1, low: 2 };
function reviewStatus(
  run: CodeReviewRun | undefined,
  freshness: CodeReviewRun['freshness'] | undefined,
  openCount: number,
) {
  if (!run) return 'Not reviewed';
  if (run.status === 'failed') return 'Failed';
  if (run.status === 'cancelled') return 'Cancelled';
  if (freshness === 'outdated') return 'Outdated';
  if (freshness === 'unknown') return 'Status unknown';
  if (openCount) return `${openCount} ${openCount === 1 ? 'issue' : 'issues'}`;
  return run.findings.length ? 'All resolved' : 'No issues';
}
export function CodeReviewPanel({
  composerActions,
  sessionId,
  capture,
  disabled,
  unavailable,
  onSelectFile,
}: Props) {
  const contentId = useId();
  const [expanded, setExpanded] = useState(false);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [providerId, setProviderId] = useState('');
  const [modelId, setModelId] = useState('');
  const [scope, setScope] = useState<'working' | 'session'>('working');
  const [selectedId, setSelectedId] = useState('');
  const { query, start, cancel, resolve } = useCodeReviews(sessionId, capture);
  const providers = useQuery({
    queryKey: providerKeys.all,
    queryFn: () => providerService.getProviders(),
    enabled: expanded || optionsOpen || historyOpen,
    staleTime: 2000,
  });
  const runs = query.data ?? [];
  const run = runs.find((run) => run.id === selectedId) ?? runs[0];
  const running = runs.find((run) => run.status === 'running');
  const freshness =
    run?.freshness === 'current' && capture
      ? run.toRevision === capture.current &&
        run.fromRevision === (run.scope === 'session' ? capture.baseline : capture.working)
        ? 'current'
        : 'outdated'
      : run?.freshness;
  const openFindings = (run?.findings ?? [])
    .filter((finding) => finding.status === 'open')
    .sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);
  const resolvedFindings = (run?.findings ?? []).filter((finding) => finding.status !== 'open');
  const earlierReview = !!run && run.id !== runs[0]?.id;
  const selectedProvider = providers.data?.find((provider) => provider.id === providerId);
  const reviewerUnavailable =
    !!providerId &&
    !providers.isPending &&
    (!selectedProvider ||
      !selectedProvider.enabled ||
      selectedProvider.hidden ||
      !['installed_local', 'system_available'].includes(selectedProvider.installState ?? ''));
  const blockedReason = unavailable
    ? 'AI review requires a workspace with revision snapshots.'
    : runs.some((run) => (run.verificationSummary?.running ?? 0) > 0)
      ? 'Wait for the verification check to finish before reviewing.'
      : disabled
        ? 'New reviews are available when the session is idle.'
        : reviewerUnavailable
          ? 'Choose an available reviewer in Review options.'
          : null;
  const error = start.error ?? cancel.error ?? resolve.error;
  const busy = !!running || start.isPending;
  const reviewerName =
    providers.data?.find((provider) => provider.id === run?.providerId)?.label ?? run?.providerId;
  const status = running
    ? 'Reviewing…'
    : start.isPending
      ? 'Starting…'
      : query.isPending
        ? 'Loading…'
        : reviewStatus(run, freshness, openFindings.length);
  const goodResult =
    run?.status === 'completed' && freshness === 'current' && !openFindings.length && !busy;
  const needsAttention =
    !busy &&
    (freshness === 'outdated' ||
      freshness === 'unknown' ||
      run?.status === 'failed' ||
      !!openFindings.length);
  const startReview = () => {
    if (busy || blockedReason || query.isPending || query.isError) return;
    setExpanded(true);
    start.mutate(
      {
        scope,
        ...(run?.verificationSummary?.total ? { evidenceReviewId: run.id } : {}),
        ...(providerId ? { providerId, ...(modelId ? { modelId } : {}) } : {}),
      },
      { onSuccess: ({ id }) => setSelectedId(id) },
    );
  };
  const findingCard = (finding: ReviewFinding) => (
    <CodeReviewFinding
      key={finding.id}
      finding={finding}
      composerActions={composerActions}
      sessionId={sessionId}
      reviewId={run!.id}
      pending={resolve.isPending}
      onSelectFile={(path) => onSelectFile(path, run!.scope)}
      onResolve={(body) =>
        resolve.mutateAsync({ reviewId: run!.id, findingId: finding.id, ...body })
      }
    />
  );
  return (
    <section aria-label="AI code review" className="border-border/40 shrink-0 border-b text-xs">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-2 gap-y-1 px-3 py-2">
        <button
          type="button"
          aria-label="AI review results"
          aria-expanded={expanded}
          aria-controls={contentId}
          aria-describedby={`${contentId}-status`}
          className="text-text-main focus-visible:ring-accent/40 flex min-w-0 cursor-pointer flex-wrap items-center gap-x-2 gap-y-1 rounded-md py-1 text-left outline-none focus-visible:ring-2"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? (
            <ChevronDownIcon size={12} className="text-text-muted shrink-0" />
          ) : (
            <ChevronRightIcon size={12} className="text-text-muted shrink-0" />
          )}
          <span className="font-semibold">AI review</span>
          <span
            id={`${contentId}-status`}
            aria-live="polite"
            aria-atomic="true"
            className={`inline-flex items-center gap-1.5 font-normal ${goodResult ? 'text-brand-teal' : needsAttention ? 'text-warning' : 'text-text-muted'}`}
          >
            {busy ? (
              <Spinner aria-hidden="true" className="icon-compact" />
            ) : goodResult ? (
              <CheckCircleIcon size={12} />
            ) : needsAttention ? (
              <AlertIcon size={12} />
            ) : null}
            {status}
          </span>
        </button>
        <div className="ml-auto flex shrink-0 items-center gap-0.5">
          <CodeReviewHistory
            open={historyOpen}
            onOpenChange={setHistoryOpen}
            runs={runs}
            selectedId={run?.id}
            onSelect={(id) => {
              setSelectedId(id);
              setExpanded(true);
            }}
            hasOlder={query.hasNextPage}
            loadingOlder={query.isFetchingNextPage}
            onLoadOlder={() => {
              void query.fetchNextPage();
            }}
          />
          <CodeReviewOptions
            open={optionsOpen}
            onOpenChange={setOptionsOpen}
            scope={scope}
            onScopeChange={setScope}
            providerId={providerId}
            onProviderChange={(id) => {
              setProviderId(id);
              setModelId('');
            }}
            modelId={modelId}
            onModelChange={setModelId}
            providers={providers.data ?? []}
            loading={providers.isPending}
            error={providers.isError}
            onRetry={() => {
              void providers.refetch();
            }}
            busy={busy}
          />
          {running ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              aria-label="Cancel review"
              aria-busy={cancel.isPending}
              disabled={cancel.isPending}
              onClick={() => cancel.mutate(running.id)}
            >
              <XIcon size={13} />
              {cancel.isPending ? 'Cancelling…' : 'Cancel'}
            </Button>
          ) : (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="ml-1 gap-1.5"
              aria-label={run ? 'Review again' : 'Review changes'}
              aria-busy={start.isPending}
              title={
                blockedReason ??
                `Review ${reviewScopeLabel(scope).toLowerCase()} with ${providerId ? (selectedProvider?.label ?? providerId) : 'the session provider and model'}`
              }
              disabled={!!blockedReason || busy || query.isPending || query.isError}
              onClick={startReview}
            >
              {start.isPending ? (
                <Spinner aria-hidden="true" className="icon-compact" />
              ) : (
                <CodeReviewIcon size={13} />
              )}
              {start.isPending ? 'Starting…' : run ? 'Review again' : 'Review changes'}
            </Button>
          )}
        </div>
      </div>
      {query.isError && (
        <p role="alert" className="text-danger px-4 pb-3">
          Could not load saved reviews.{' '}
          <button
            type="button"
            className="cursor-pointer underline"
            onClick={() => {
              void query.refetch();
            }}
          >
            Retry
          </button>
        </p>
      )}
      {error && (
        <p role="alert" className="text-danger px-4 pb-3 [overflow-wrap:anywhere]">
          {error.message}
        </p>
      )}
      {expanded && (
        <div id={contentId} className="max-h-[min(40vh,24rem)] space-y-3 overflow-y-auto px-4 pb-3">
          {blockedReason && <p className="text-text-muted leading-relaxed">{blockedReason}</p>}
          {run ? (
            <>
              <div className="text-text-muted flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-[11px]">
                {earlierReview && (
                  <>
                    <span className="text-accent font-medium">Earlier review</span>
                    <span aria-hidden="true">·</span>
                  </>
                )}
                <span>{reviewScopeLabel(run.scope)}</span>
                <span aria-hidden="true">·</span>
                <span className="max-w-full truncate" title={reviewerName}>
                  {reviewerName}
                </span>
                <span aria-hidden="true">·</span>
                <time dateTime={new Date(run.startedAt).toISOString()}>
                  {reviewTime(run.startedAt)}
                </time>
                {earlierReview && (
                  <button
                    type="button"
                    className="text-accent ml-auto cursor-pointer hover:underline"
                    onClick={() => setSelectedId('')}
                  >
                    Show latest
                  </button>
                )}
              </div>
              {freshness === 'outdated' && (
                <p
                  role="status"
                  className="border-warning/20 bg-warning/5 text-warning rounded-md border px-2.5 py-2 leading-relaxed"
                >
                  Outdated review. These findings describe an earlier version of your changes.
                </p>
              )}
              {freshness === 'unknown' && (
                <p role="status" className="text-warning leading-relaxed">
                  Could not verify whether this review is current. Saved findings remain available.
                </p>
              )}
              {run.error && (
                <p
                  role={run.status === 'cancelled' ? 'status' : 'alert'}
                  className={`${run.status === 'cancelled' ? 'text-text-muted' : 'text-danger'} leading-relaxed [overflow-wrap:anywhere]`}
                >
                  {run.error}
                </p>
              )}
              {running?.id === run.id && (
                <p role="status" className="text-text-muted leading-relaxed">
                  Checking the captured changes for bugs…
                </p>
              )}
              <CodeReviewWalkthrough
                key={`tour:${run.id}`}
                sessionId={sessionId}
                run={run}
                freshness={freshness ?? 'unknown'}
                composerActions={composerActions}
              />
              {openFindings.length > 0 && (
                <ul aria-label="Open findings" className="space-y-2">
                  {openFindings.map(findingCard)}
                </ul>
              )}
              {resolvedFindings.length > 0 && (
                <details className="group/resolved">
                  <summary className="text-text-muted hover:text-text-main cursor-pointer py-1">
                    Resolved findings ({resolvedFindings.length})
                  </summary>
                  <ul aria-label="Resolved findings" className="mt-2 space-y-2">
                    {resolvedFindings.map(findingCard)}
                  </ul>
                </details>
              )}
              <CodeReviewVerification
                key={`verification:${run.id}`}
                sessionId={sessionId}
                run={run}
                freshness={freshness ?? 'unknown'}
                disabled={!!disabled || !!unavailable || !!running || start.isPending}
              />
              {run.continuity &&
                (run.continuity.provided > 0 ||
                  run.continuity.omitted > 0 ||
                  run.continuity.historyLimited) && (
                  <details className="text-text-muted text-[11px]">
                    <summary className="hover:text-text-main cursor-pointer">
                      Prior review context · {run.continuity.provided} findings supplied
                    </summary>
                    <p className="mt-2 leading-relaxed">
                      Earlier findings, decisions, and verification history were provided as
                      context. A missing finding is not automatically marked fixed.
                      {run.continuity.omitted
                        ? ` ${run.continuity.omitted} relevant findings were omitted by the context budget.`
                        : ''}
                      {run.continuity.historyLimited
                        ? ' History was limited to the ten most recent completed reviews in this scope.'
                        : ''}
                    </p>
                  </details>
                )}
              <CodeReviewContext
                key={`context:${run.id}`}
                context={run.context}
                status={run.status}
              />
              {run.status === 'completed' && (
                <details key={run.id} className="text-text-muted">
                  <summary className="hover:text-text-main w-fit cursor-pointer py-0.5 text-[11px]">
                    Review summary
                  </summary>
                  <div className="border-border/40 mt-2 space-y-2 border-l pl-3">
                    {run.summary && (
                      <p className="text-text-main/90 leading-relaxed [overflow-wrap:anywhere] whitespace-pre-wrap">
                        {run.summary}
                      </p>
                    )}
                    <p className="text-[11px] leading-relaxed [overflow-wrap:anywhere]">
                      {reviewerName} · {run.modelId}
                      <br />
                      {run.context?.files.length ? 'Diff and source context' : 'Diff review only'} ·
                      {run.evidenceCheckIds?.length
                        ? `${run.evidenceCheckIds.length} saved checks supplied`
                        : 'No execution evidence supplied'}
                    </p>
                  </div>
                </details>
              )}
            </>
          ) : (
            !query.isPending &&
            !query.isError &&
            !blockedReason && (
              <p className="text-text-muted leading-relaxed">
                Review your changes for bugs before committing. Choose a reviewer and scope in
                Review options.
              </p>
            )
          )}
        </div>
      )}
    </section>
  );
}
