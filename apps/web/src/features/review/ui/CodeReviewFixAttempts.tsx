import { useState } from 'react';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  listReviewFixes,
  verifyReviewFix,
  reviewReviewFix,
  cancelReviewCheck,
  cancelCodeReview,
} from '@agentctl/api-client';
import { Button, LoadingState } from '@agentctl/ui';
import type { ReviewFix } from '@agentctl/shared';
import { sessionKeys } from '@/shared/lib/queryKeys';
import { ReviewCheckOutput } from './CodeReviewVerification';

export const fixAttemptsKey = (sessionId: string, reviewId: string, findingId: string) =>
  ['review-fix-attempts', sessionId, reviewId, findingId] as const;
function Attempt({
  sessionId,
  attempt,
  refresh,
}: {
  sessionId: string;
  attempt: ReviewFix;
  refresh(): void;
}) {
  const [command, setCommand] = useState(
    attempt.before && !attempt.before.commandRedacted ? attempt.before.command : '',
  );
  const [output, setOutput] = useState(false);
  const mutation = useMutation({
    mutationFn: async (action: 'check' | 'review' | 'cancel') => {
      if (action === 'check')
        return verifyReviewFix(sessionId, attempt.reviewId, attempt.findingId, attempt.id, {
          command: command.trim(),
          timeoutMs: attempt.before?.timeoutMs ?? 180000,
          name: 'Tracked fix verification',
        });
      if (action === 'review')
        return reviewReviewFix(sessionId, attempt.reviewId, attempt.findingId, attempt.id);
      if (attempt.outcome === 'checking' && attempt.after)
        return cancelReviewCheck(sessionId, attempt.after.reviewId, attempt.after.id);
      if (attempt.outcome === 'reviewing' && attempt.followup)
        return cancelCodeReview(sessionId, attempt.followup.id);
    },
    onSettled: refresh,
  });
  const running = ['checking', 'reviewing'].includes(attempt.outcome);
  return (
    <li className="border-border/40 space-y-2 rounded-md border p-2.5">
      <p
        className={`font-medium ${attempt.outcome === 'suggested_fixed' ? 'text-brand-teal' : 'text-text-main'}`}
      >
        {
          {
            not_checked: 'Not checked',
            checking: 'Checking…',
            reviewing: 'Reviewing…',
            suggested_fixed: 'Suggested fixed',
            still_failing: 'Check still failing',
            needs_investigation: 'Needs investigation',
          }[attempt.outcome]
        }
      </p>
      <p className="text-text-muted text-[11px] leading-relaxed">{attempt.reason}</p>
      <p className="text-text-muted text-[10px] [overflow-wrap:anywhere]">
        {new Date(attempt.createdAt).toLocaleString()} ·{' '}
        {attempt.requestEventId
          ? `Request found in conversation (event ${attempt.requestEventId})`
          : 'Request prepared; not found in conversation yet'}
        <br />
        Request revision: {attempt.requestRevision}
        <br />
        After revision: {attempt.after?.checkedRevision ?? 'Not captured'}
      </p>
      <div className="text-[11px]">
        <p>
          Before:{' '}
          {attempt.before
            ? `${attempt.before.status} · exit ${attempt.before.exitCode ?? 'unknown'} · ${attempt.before.command}`
            : 'No failing baseline selected'}
        </p>
        <p>
          After:{' '}
          {attempt.after
            ? `${attempt.after.status} · exit ${attempt.after.exitCode ?? 'unknown'} · ${attempt.after.command}`
            : 'No after-check recorded'}
        </p>
      </div>
      <form
        className="space-y-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (command.trim() && !running && !mutation.isPending) mutation.mutate('check');
        }}
      >
        <textarea
          aria-label="Fix verification command"
          rows={2}
          value={command}
          maxLength={4000}
          onChange={(event) => setCommand(event.target.value)}
          placeholder="Choose the reproduction command to run on the current code"
          className="border-border bg-surface focus:border-accent w-full rounded-md border p-2 font-mono text-[11px] outline-none"
        />
        <p className="text-text-muted text-[10px]">
          Runs explicitly in this workspace. A changed command or missing baseline cannot establish
          a comparable fix.
        </p>
        <div className="flex flex-wrap gap-1">
          <Button
            type="submit"
            size="sm"
            variant="outline"
            disabled={running || mutation.isPending || !command.trim()}
          >
            Run selected check
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={
              running ||
              mutation.isPending ||
              !attempt.after ||
              !['passed', 'failed'].includes(attempt.after.status) ||
              attempt.freshness !== 'current'
            }
            onClick={() => mutation.mutate('review')}
          >
            Review with session provider
          </Button>
          {running && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={mutation.isPending}
              onClick={() => mutation.mutate('cancel')}
            >
              Cancel operation
            </Button>
          )}
        </div>
      </form>
      {attempt.followup && (
        <p className="text-text-muted text-[11px] [overflow-wrap:anywhere] whitespace-pre-wrap">
          Independent review: {attempt.followup.providerId} · {attempt.followup.modelId} ·{' '}
          {attempt.followup.status}
          <br />
          {attempt.followup.error ?? attempt.followup.summary}
          <br />
          {attempt.followup.findings} findings reported
        </p>
      )}
      <button
        type="button"
        className="text-accent cursor-pointer text-[11px] hover:underline"
        onClick={() => setOutput(!output)}
      >
        {output ? 'Hide attempt evidence' : 'Inspect attempt evidence'}
      </button>
      {output && (
        <div className="space-y-3">
          {attempt.before && (
            <div>
              <p>Before output</p>
              <ReviewCheckOutput
                sessionId={sessionId}
                reviewId={attempt.before.reviewId}
                checkId={attempt.before.id}
              />
            </div>
          )}
          {attempt.runs
            .filter((run) => run.kind === 'check')
            .map((run, index) => (
              <div key={run.id}>
                <p>
                  After check {index + 1}
                  {run.id === attempt.after?.id ? ' · latest' : ''}
                </p>
                <ReviewCheckOutput sessionId={sessionId} reviewId={run.reviewId} checkId={run.id} />
              </div>
            ))}
        </div>
      )}
      {mutation.error && (
        <p role="alert" className="text-danger text-[11px] [overflow-wrap:anywhere]">
          {mutation.error.message}
        </p>
      )}
      <p className="text-text-muted text-[10px]">
        Use the finding’s manual resolution controls after inspecting this evidence. Revision
        changes do not establish who authored them.
      </p>
    </li>
  );
}
export function CodeReviewFixAttempts({
  sessionId,
  reviewId,
  findingId,
}: {
  sessionId: string;
  reviewId: string;
  findingId: string;
}) {
  const [open, setOpen] = useState(false);
  const client = useQueryClient();
  const key = fixAttemptsKey(sessionId, reviewId, findingId);
  const query = useInfiniteQuery({
    queryKey: key,
    queryFn: ({ signal, pageParam }) =>
      listReviewFixes(sessionId, reviewId, findingId, pageParam, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    enabled: open,
    refetchInterval: open ? 2000 : false,
  });
  const refresh = () => {
    void client.invalidateQueries({ queryKey: key });
    void client.invalidateQueries({ queryKey: sessionKeys.codeReviews(sessionId) });
  };
  const attempts = query.data?.pages.flatMap((page) => page.attempts) ?? [];
  return (
    <details
      onToggle={(event) => setOpen(event.currentTarget.open)}
      className="border-border/40 border-t pt-2"
    >
      <summary className="text-text-muted cursor-pointer text-[11px]">Tracked fix attempts</summary>
      {open && (
        <div className="mt-2 space-y-2">
          <p className="text-text-muted text-[11px]">
            Fix requests create attempts. Run the selected check after code changes, then request a
            fresh independent review. Final resolution stays manual.
          </p>
          {query.isPending ? (
            <LoadingState variant="inline" message="Loading fix attempts…" />
          ) : (
            <ul className="space-y-2">
              {attempts.map((attempt) => (
                <Attempt
                  key={attempt.id}
                  sessionId={sessionId}
                  attempt={attempt}
                  refresh={refresh}
                />
              ))}
            </ul>
          )}
          {!query.isPending && !attempts.length && (
            <p className="text-text-muted text-[11px]">
              No attempts yet. Use Fix this finding to prepare a tracked request.
            </p>
          )}
          {query.isError && (
            <p role="alert" className="text-danger text-[11px]">
              Could not load attempts.{' '}
              <button
                type="button"
                className="underline"
                onClick={() => {
                  void query.refetch();
                }}
              >
                Retry
              </button>
            </p>
          )}
          {query.hasNextPage && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={query.isFetchingNextPage}
              onClick={() => {
                void query.fetchNextPage();
              }}
            >
              Load older attempts
            </Button>
          )}
        </div>
      )}
    </details>
  );
}
