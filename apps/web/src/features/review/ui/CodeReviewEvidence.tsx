import { useState } from 'react';
import { Button, Select, LoadingState } from '@agentctl/ui';
import type { ReviewFinding } from '@agentctl/shared';
import { useReviewChecks } from '../model/useReviewChecks';
import { ReviewCheckOutput } from './CodeReviewVerification';

export function CodeReviewEvidence({
  sessionId,
  reviewId,
  finding,
}: {
  sessionId: string;
  reviewId: string;
  finding: ReviewFinding;
}) {
  const [open, setOpen] = useState(false);
  const [checkId, setCheckId] = useState('');
  const [reason, setReason] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const { query, checks, confirm } = useReviewChecks(sessionId, reviewId, open);
  const eligible = checks.filter(
    (check) =>
      check.status === 'failed' &&
      check.exitCode !== null &&
      check.exitCode !== 0 &&
      !check.signal &&
      check.revisionState === 'unchanged' &&
      check.checkedRevision === check.expectedRevision &&
      check.afterRevision === check.expectedRevision,
  );
  const reproduced = finding.verification?.state === 'reproduced';
  return (
    <div className="space-y-2">
      <button
        type="button"
        aria-expanded={open}
        className={`cursor-pointer text-[11px] hover:underline ${reproduced ? 'text-brand-teal' : 'text-text-muted'}`}
        onClick={() => setOpen(!open)}
      >
        {reproduced ? 'Reproduced · confirmed by you' : 'Suspected · add evidence'}
      </button>
      {open && (
        <div className="border-border/40 space-y-2 border-l pl-3 text-[11px]">
          <p className="text-text-muted leading-relaxed">
            Evidence applies to the revision reviewed. A failed check alone does not prove this
            finding.
          </p>
          {finding.verification?.reason && (
            <p className="[overflow-wrap:anywhere] whitespace-pre-wrap">
              {finding.verification.reason}
            </p>
          )}
          {reproduced && finding.verification?.checkId && (
            <ReviewCheckOutput
              sessionId={sessionId}
              reviewId={reviewId}
              checkId={finding.verification.checkId}
            />
          )}
          {query.isError && (
            <p role="alert" className="text-danger">
              Could not load evidence.{' '}
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
          {query.isPending ? (
            <LoadingState variant="inline" message="Loading checks…" />
          ) : eligible.length ? (
            <form
              className="space-y-2"
              onSubmit={(event) => {
                event.preventDefault();
                if (checkId && reason.trim().length >= 10 && confirmed && !confirm.isPending)
                  confirm.mutate(
                    { findingId: finding.id, state: 'reproduced', checkId, reason: reason.trim() },
                    {
                      onSuccess: () => {
                        setReason('');
                        setConfirmed(false);
                      },
                    },
                  );
              }}
            >
              <Select
                aria-label="Reproduction check"
                value={checkId}
                options={[
                  { value: '', label: 'Choose a failing check' },
                  ...eligible.map((check) => ({ value: check.id, label: check.name })),
                ]}
                onChange={(value) => {
                  setCheckId(value);
                  setConfirmed(false);
                }}
              />
              <textarea
                aria-label="Reproduction explanation"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                maxLength={2000}
                placeholder="Explain how this failure demonstrates the reported problem"
                rows={3}
                className="border-border bg-surface focus:border-accent w-full rounded-md border p-2 outline-none"
              />
              <label className="flex items-start gap-2 leading-relaxed">
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(event) => setConfirmed(event.target.checked)}
                  className="mt-0.5"
                />
                I inspected the output and confirmed it reproduces this finding.
              </label>
              <Button
                type="submit"
                variant="outline"
                size="sm"
                disabled={
                  confirm.isPending ||
                  !eligible.some((check) => check.id === checkId) ||
                  reason.trim().length < 10 ||
                  !confirmed
                }
              >
                Confirm reproduction
              </Button>
            </form>
          ) : (
            <p className="text-text-muted">
              Run a failing check under Verification, inspect its output, then link it here.
            </p>
          )}
          {query.hasNextPage && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={query.isFetchingNextPage}
              onClick={() => {
                void query.fetchNextPage();
              }}
            >
              Load older checks
            </Button>
          )}
          {reproduced && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={confirm.isPending}
              onClick={() =>
                confirm.mutate({
                  findingId: finding.id,
                  state: 'suspected',
                  reason: 'Reproduction confirmation withdrawn by the user.',
                })
              }
            >
              Mark suspected
            </Button>
          )}
          {confirm.error && (
            <p role="alert" className="text-danger [overflow-wrap:anywhere]">
              {confirm.error.message}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
