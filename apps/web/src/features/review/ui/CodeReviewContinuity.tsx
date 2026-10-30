import { useState } from 'react';
import type { ReviewFindingContinuity } from '@agentctl/shared';
import { ReviewCheckOutput } from './CodeReviewVerification';

export function CodeReviewContinuity({
  sessionId,
  continuity,
}: {
  sessionId: string;
  continuity: ReviewFindingContinuity;
}) {
  const [showOutput, setShowOutput] = useState(false);
  const evidence =
    continuity.lastEvidence ??
    (continuity.verification.confirmedAt !== null
      ? {
          reviewId: continuity.reviewId,
          findingId: continuity.findingId,
          verification: continuity.verification,
        }
      : null);
  return (
    <details className="border-border/40 text-text-muted border-l pl-3 text-[11px]">
      <summary className="hover:text-text-main cursor-pointer">
        Seen in an earlier review ·{' '}
        {continuity.status === 'open'
          ? 'was open'
          : continuity.status === 'dismissed'
            ? 'was dismissed'
            : 'was marked fixed'}
      </summary>
      <div className="mt-2 space-y-2 leading-relaxed">
        <p>
          {continuity.comparison === 'same'
            ? 'The captured comparison is unchanged.'
            : 'The captured comparison changed. Recheck the earlier assessment.'}{' '}
          {continuity.match === 'reviewer'
            ? 'The reviewer linked this occurrence; the source fingerprint did not match.'
            : 'Matched by location-independent code and title.'}{' '}
          This occurrence starts open and suspected.
        </p>
        {continuity.resolution && (
          <p className="[overflow-wrap:anywhere] whitespace-pre-wrap">
            Earlier reason: {continuity.resolution}
          </p>
        )}
        {continuity.lastDecision &&
          (continuity.lastDecision.findingId !== continuity.findingId ||
            continuity.lastDecision.resolution !== continuity.resolution) && (
            <p className="[overflow-wrap:anywhere] whitespace-pre-wrap">
              Last saved decision:{' '}
              {continuity.lastDecision.status === 'dismissed' ? 'dismissed' : 'marked fixed'}
              {continuity.lastDecision.resolution ? ` · ${continuity.lastDecision.resolution}` : ''}
            </p>
          )}
        {evidence && (
          <div className="space-y-2">
            <p>
              Earlier verification:{' '}
              {evidence.verification.state === 'reproduced'
                ? 'reproduced, confirmed by you'
                : 'suspected'}
              {evidence.verification.reason ? ` · ${evidence.verification.reason}` : ''}. Evidence
              describes that earlier review version.
            </p>
            {evidence.verification.checkId && (
              <>
                <button
                  type="button"
                  className="text-accent cursor-pointer hover:underline"
                  onClick={() => setShowOutput(!showOutput)}
                >
                  {showOutput ? 'Hide earlier output' : 'View earlier output'}
                </button>
                {showOutput && (
                  <ReviewCheckOutput
                    sessionId={sessionId}
                    reviewId={evidence.reviewId}
                    checkId={evidence.verification.checkId}
                  />
                )}
              </>
            )}
          </div>
        )}
        <p className="text-text-muted/70">
          History reflects the decisions available when this review started.
        </p>
      </div>
    </details>
  );
}
