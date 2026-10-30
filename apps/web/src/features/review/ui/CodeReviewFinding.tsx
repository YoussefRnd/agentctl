import { CodeReviewHandoff } from './CodeReviewHandoff';
import type { ReviewComposerActions } from '../model/composer-actions';
import { CodeReviewExcerpt } from './CodeReviewExcerpt';
import { CodeReviewContinuity } from './CodeReviewContinuity';
import { CodeReviewEvidence } from './CodeReviewEvidence';
import { useState } from 'react';
import { Button, Input } from '@agentctl/ui';
import { CheckIcon, XIcon } from '@primer/octicons-react';
import type { ReviewFinding, ResolveReviewFinding } from '@agentctl/shared';

export function CodeReviewFinding({
  finding,
  sessionId,
  reviewId,
  pending,
  showExcerpt = true,
  composerActions,
  onResolve,
  onSelectFile,
}: {
  finding: ReviewFinding;
  sessionId?: string;
  reviewId?: string;
  pending: boolean;
  showExcerpt?: boolean;
  composerActions?: ReviewComposerActions;
  onResolve(body: ResolveReviewFinding): Promise<unknown>;
  onSelectFile(path: string): void;
}) {
  const [dismissing, setDismissing] = useState(false);
  const [reason, setReason] = useState('');
  const severity = { high: 'High', medium: 'Medium', low: 'Low' }[finding.severity];
  return (
    <li
      id={showExcerpt ? `review-finding-${finding.id}` : undefined}
      className="border-border/40 bg-surface/40 min-w-0 space-y-2.5 rounded-lg border p-3"
    >
      <div className="flex items-start gap-2">
        <span
          className={`shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${finding.severity === 'high' ? 'bg-danger/10 text-danger' : finding.severity === 'medium' ? 'bg-warning/10 text-warning' : 'bg-surface-tertiary text-text-muted'}`}
        >
          {severity}
        </span>
        <strong className="text-text-main min-w-0 flex-1 leading-relaxed [overflow-wrap:anywhere]">
          {finding.title}
        </strong>
      </div>
      <button
        type="button"
        className="text-accent block max-w-full cursor-pointer text-left font-mono text-[11px] [overflow-wrap:anywhere] hover:underline"
        onClick={() => onSelectFile(finding.path)}
        title="Open this file in the current workspace; it may differ from the captured code"
      >
        {finding.path}:{finding.line}
      </button>
      {showExcerpt && sessionId && reviewId && (
        <CodeReviewExcerpt
          sessionId={sessionId}
          reviewId={reviewId}
          path={finding.path}
          line={finding.line}
        />
      )}
      <p className="text-text-main/90 leading-relaxed [overflow-wrap:anywhere] whitespace-pre-wrap">
        {finding.body}
      </p>
      {sessionId && reviewId && (
        <CodeReviewEvidence sessionId={sessionId} reviewId={reviewId} finding={finding} />
      )}
      {sessionId && finding.continuity && (
        <CodeReviewContinuity sessionId={sessionId} continuity={finding.continuity} />
      )}
      {finding.resolution && (
        <p className="text-text-muted leading-relaxed [overflow-wrap:anywhere]">
          {finding.resolution}
        </p>
      )}
      {sessionId && reviewId && composerActions && (
        <CodeReviewHandoff
          sessionId={sessionId}
          reviewId={reviewId}
          findingId={finding.id}
          title={finding.title}
          line={finding.line}
          composerActions={composerActions}
        />
      )}
      {finding.status === 'open' ? (
        dismissing ? (
          <form
            className="space-y-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (!reason.trim() || pending) return;
              void onResolve({ status: 'dismissed', resolution: reason.trim() })
                .then(() => {
                  setDismissing(false);
                  setReason('');
                })
                .catch(() => undefined);
            }}
          >
            <Input
              autoFocus
              aria-label="Dismissal reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              maxLength={2000}
              placeholder="Why can this finding be dismissed?"
              disabled={pending}
              className="w-full min-w-0"
            />
            <div className="flex flex-wrap justify-end gap-1.5">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={pending}
                onClick={() => setDismissing(false)}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                type="submit"
                variant="outline"
                disabled={pending || !reason.trim()}
              >
                Save reason
              </Button>
            </div>
          </form>
        ) : (
          <div className="flex flex-wrap gap-1">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={pending}
              title="Mark as fixed; a new review is needed to check the fix"
              onClick={() => {
                void onResolve({ status: 'fixed' }).catch(() => undefined);
              }}
            >
              <CheckIcon size={12} />
              Mark fixed
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={pending}
              onClick={() => setDismissing(true)}
            >
              <XIcon size={12} />
              Dismiss
            </Button>
          </div>
        )
      ) : (
        <div className="text-text-muted flex flex-wrap items-center justify-between gap-2">
          <span>{finding.status === 'fixed' ? 'Marked fixed' : 'Dismissed'}</span>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={pending}
            onClick={() => {
              void onResolve({ status: 'open' }).catch(() => undefined);
            }}
          >
            Reopen
          </Button>
        </div>
      )}
    </li>
  );
}
