import { useState } from 'react';
import { Button, Input, Select, LoadingState } from '@agentctl/ui';
import type { CodeReviewRun, ReviewCheckSummary } from '@agentctl/shared';
import { useReviewChecks, useReviewCheck } from '../model/useReviewChecks';

export function ReviewCheckOutput({
  sessionId,
  reviewId,
  checkId,
}: {
  sessionId: string;
  reviewId: string;
  checkId: string;
}) {
  const result = useReviewCheck(sessionId, reviewId, checkId, true);
  if (result.isPending) return <LoadingState variant="inline" message="Loading saved output…" />;
  if (result.isError)
    return (
      <p role="alert" className="text-danger">
        Could not load output.{' '}
        <button
          type="button"
          className="underline"
          onClick={() => {
            void result.refetch();
          }}
        >
          Retry
        </button>
      </p>
    );
  const check = result.data;
  return (
    <div className="space-y-2 text-[11px]">
      <p className="text-text-muted [overflow-wrap:anywhere]">
        Workspace: {check.cwd}
        <br />
        Checked revision: {check.checkedRevision ?? 'Not captured'}
        <br />
        {new Date(check.startedAt).toLocaleString()}
        {check.finishedAt ? ` · ${((check.finishedAt - check.startedAt) / 1000).toFixed(1)}s` : ''}
      </p>
      {check.error && <p className="text-warning [overflow-wrap:anywhere]">{check.error}</p>}
      {(['stdout', 'stderr'] as const).map((stream) => (
        <div key={stream}>
          <p className="text-text-muted mb-1">{stream}</p>
          <pre className="bg-surface max-h-48 overflow-auto rounded p-2 font-mono [overflow-wrap:anywhere] whitespace-pre-wrap">
            {check[stream] || '(empty)'}
          </pre>
        </div>
      ))}
      {check.outputTruncated && (
        <p className="text-warning">Output truncated. Only the saved tail is shown.</p>
      )}
      <p className="text-text-muted">
        Output and commands are redacted before saving. Review them before sharing.
      </p>
    </div>
  );
}
function CheckRow({
  check,
  sessionId,
  reviewId,
  onCancel,
  cancelling,
  onReuse,
}: {
  check: ReviewCheckSummary;
  sessionId: string;
  reviewId: string;
  onCancel(): void;
  cancelling: boolean;
  onReuse(command: string): void;
}) {
  const [open, setOpen] = useState(false);
  const running = ['pending', 'running'].includes(check.status);
  return (
    <li className="border-border/40 space-y-2 rounded-md border p-2.5">
      <button
        type="button"
        aria-expanded={open}
        className="flex w-full cursor-pointer items-start justify-between gap-2 text-left"
        onClick={() => setOpen(!open)}
      >
        <span className="min-w-0 [overflow-wrap:anywhere]">{check.name}</span>
        <span
          className={`shrink-0 ${check.status === 'passed' ? 'text-brand-teal' : check.status === 'failed' ? 'text-warning' : 'text-text-muted'}`}
        >
          {check.status.replace('_', ' ')}
          {check.exitCode !== null ? ` · exit ${check.exitCode}` : ''}
        </span>
      </button>
      <code className="text-text-muted block text-[11px] [overflow-wrap:anywhere] whitespace-pre-wrap">
        {check.command}
      </code>
      {!running && (
        <p
          className={`text-[11px] ${check.revisionState === 'unchanged' ? 'text-text-muted' : 'text-warning'}`}
        >
          {check.revisionState === 'unchanged'
            ? 'Review revision matched before and after execution.'
            : check.revisionState === 'changed'
              ? 'Workspace changed. This result cannot confirm reproduction.'
              : 'Revision could not be verified. This result cannot confirm reproduction.'}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="text-accent cursor-pointer text-[11px] hover:underline"
          onClick={() => setOpen(!open)}
        >
          {open ? 'Hide output' : 'View output'}
        </button>
        {running ? (
          <button
            type="button"
            disabled={cancelling}
            className="text-warning cursor-pointer text-[11px]"
            onClick={onCancel}
          >
            Cancel check
          </button>
        ) : (
          <button
            type="button"
            className="text-text-muted cursor-pointer text-[11px] hover:underline"
            onClick={() => onReuse(check.command)}
          >
            Use command
          </button>
        )}
      </div>
      {check.commandRedacted && (
        <p className="text-text-muted text-[11px]">
          Saved command contains redactions; edit it before running again.
        </p>
      )}
      {open && <ReviewCheckOutput sessionId={sessionId} reviewId={reviewId} checkId={check.id} />}
    </li>
  );
}
export function CodeReviewVerification({
  sessionId,
  run,
  disabled,
  freshness,
}: {
  sessionId: string;
  run: CodeReviewRun;
  disabled: boolean;
  freshness: CodeReviewRun['freshness'];
}) {
  const [open, setOpen] = useState(false);
  const [command, setCommand] = useState('');
  const [name, setName] = useState('');
  const [timeoutMs, setTimeoutMs] = useState(180000);
  const { query, checks, start, cancel } = useReviewChecks(sessionId, run.id, open);
  const running = checks.some((check) => ['pending', 'running'].includes(check.status));
  const blocked =
    disabled || freshness !== 'current' || run.status !== 'completed' || running || start.isPending;
  const error = start.error ?? cancel.error;
  return (
    <details
      id={`review-verification-${run.id}`}
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
      className="border-border/40 border-t pt-2"
    >
      <summary className="text-text-muted hover:text-text-main cursor-pointer py-1">
        Verification
        {run.verificationSummary?.total ? ` · ${run.verificationSummary.total} saved checks` : ''}
      </summary>
      {open && (
        <div className="mt-2 space-y-3">
          <p className="text-text-muted text-[11px] leading-relaxed">
            Run a command in this workspace using its installed tools and dependencies. Commands can
            change files. Results and output are saved; passing checks do not clear findings.
          </p>
          {freshness !== 'current' && (
            <p className="text-warning">Review the current changes before running a check.</p>
          )}
          <form
            className="space-y-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (!blocked && command.trim())
                start.mutate({
                  command: command.trim(),
                  ...(name.trim() ? { name: name.trim() } : {}),
                  timeoutMs,
                });
            }}
          >
            <Input
              aria-label="Check name"
              placeholder="Check name (optional)"
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={100}
              className="w-full"
            />
            <textarea
              aria-label="Verification command"
              placeholder="e.g. pnpm test path/to/test"
              value={command}
              onChange={(event) => setCommand(event.target.value)}
              maxLength={4000}
              rows={2}
              className="border-border bg-surface focus:border-accent w-full resize-y rounded-md border p-2 font-mono text-[11px] outline-none"
            />
            <div className="flex items-center gap-2">
              <Select
                aria-label="Check timeout"
                value={String(timeoutMs)}
                options={[
                  { value: '60000', label: '1 minute' },
                  { value: '180000', label: '3 minutes' },
                  { value: '600000', label: '10 minutes' },
                ]}
                onChange={(value) => setTimeoutMs(Number(value))}
              />
              <Button
                type="submit"
                variant="outline"
                size="sm"
                disabled={blocked || !command.trim()}
              >
                {start.isPending ? 'Starting…' : 'Run check'}
              </Button>
            </div>
          </form>
          {error && (
            <p role="alert" className="text-danger [overflow-wrap:anywhere]">
              {error.message}
            </p>
          )}
          {query.isError && (
            <p role="alert" className="text-danger">
              Could not load checks.{' '}
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
          ) : checks.length ? (
            <ul aria-label="Saved verification checks" className="space-y-2">
              {checks.map((check) => (
                <CheckRow
                  key={check.id}
                  check={check}
                  sessionId={sessionId}
                  reviewId={run.id}
                  cancelling={cancel.isPending}
                  onCancel={() => cancel.mutate(check.id)}
                  onReuse={setCommand}
                />
              ))}
            </ul>
          ) : (
            <p className="text-text-muted text-[11px]">No checks saved for this review.</p>
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
              Load older checks
            </Button>
          )}
        </div>
      )}
    </details>
  );
}
