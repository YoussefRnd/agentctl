import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@agentctl/ui';
import { prepareWalkthroughQuestion, updateWalkthroughProgress } from '@agentctl/api-client';
import type { CodeReviewRun, UpdateWalkthroughProgress } from '@agentctl/shared';
import type { ReviewComposerActions } from '../model/composer-actions';
import { sessionKeys } from '@/shared/lib/queryKeys';
import { CodeReviewExcerpt } from './CodeReviewExcerpt';

function OtherFile({
  sessionId,
  reviewId,
  path,
}: {
  sessionId: string;
  reviewId: string;
  path: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <details onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary className="text-accent cursor-pointer font-mono text-[11px] [overflow-wrap:anywhere]">
        {path}
      </summary>
      {open && (
        <CodeReviewExcerpt
          sessionId={sessionId}
          reviewId={reviewId}
          path={path}
          line={1}
          firstChange
        />
      )}
    </details>
  );
}
export function CodeReviewWalkthrough({
  sessionId,
  run,
  freshness,
  composerActions,
}: {
  sessionId: string;
  run: CodeReviewRun;
  freshness: CodeReviewRun['freshness'];
  composerActions?: ReviewComposerActions;
}) {
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState('');
  const generation = useRef(0);
  const controller = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      generation.current++;
      controller.current?.abort();
    },
    [sessionId, run.id],
  );
  const save = useMutation({
    mutationFn: (body: UpdateWalkthroughProgress) =>
      updateWalkthroughProgress(sessionId, run.id, body),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: sessionKeys.codeReviews(sessionId) });
    },
  });
  const tour = run.walkthrough;
  if (!tour?.length)
    return run.status === 'completed' ? (
      <p className="text-text-muted text-[11px]">
        No walkthrough explanations were saved for this review. Review again to generate one.
      </p>
    ) : null;
  const progress = run.walkthroughProgress ?? { position: 0, seen: [] };
  const position = Math.min(progress.position, tour.length - 1);
  const stop = tour[position];
  const paths = new Set([...stop.files, ...stop.excerpts.map((excerpt) => excerpt.path)]);
  const findings = run.findings.filter((finding) => paths.has(finding.path));
  const ask = async () => {
    if (!composerActions || asking) return;
    const token = ++generation.current;
    controller.current?.abort();
    controller.current = new AbortController();
    setAsking(true);
    setError('');
    try {
      const result = await prepareWalkthroughQuestion(
        sessionId,
        run.id,
        position,
        controller.current.signal,
      );
      if (token !== generation.current) return;
      void client.invalidateQueries({ queryKey: sessionKeys.codeReviews(sessionId) });
      composerActions.insertIntoComposer(result.prompt);
    } catch (cause) {
      if (token === generation.current)
        setError(cause instanceof Error ? cause.message : 'Could not prepare question.');
    } finally {
      if (token === generation.current) setAsking(false);
    }
  };
  return (
    <details
      open={open}
      onToggle={(event) => {
        const next = event.currentTarget.open;
        setOpen(next);
        if (!next) {
          generation.current++;
          controller.current?.abort();
          setAsking(false);
        }
      }}
      className="border-border/40 border-b pb-2 text-xs"
      aria-label="Guided change walkthrough"
    >
      <summary className="text-text-main cursor-pointer py-1 font-medium">
        Change walkthrough · {progress.seen.length}/{tour.length} reviewed
      </summary>
      {open && (
        <div className="mt-3 space-y-3">
          {freshness !== 'current' && (
            <p role="status" className="text-warning leading-relaxed">
              {freshness === 'outdated'
                ? 'Outdated walkthrough. These explanations and excerpts describe the saved review version.'
                : 'Walkthrough freshness is unknown. These excerpts remain tied to the saved version.'}
            </p>
          )}
          <nav aria-label="Walkthrough reading order" className="flex flex-wrap gap-1">
            {tour.map((item, index) => (
              <button
                key={index}
                type="button"
                disabled={save.isPending}
                aria-current={position === index ? 'step' : undefined}
                className={`border-border/40 max-w-full cursor-pointer rounded border px-2 py-1 text-left text-[11px] [overflow-wrap:anywhere] ${index === position ? 'bg-accent/10 text-accent' : 'text-text-muted'}`}
                onClick={() => save.mutate({ action: 'navigate', position: index })}
              >
                {progress.seen.includes(index) ? '✓ ' : ''}
                {index + 1}. {item.title}
              </button>
            ))}
          </nav>
          <article className="space-y-3">
            <div>
              <p className="text-text-muted text-[10px]">
                Stop {position + 1} of {tour.length}
              </p>
              <h3 className="text-text-main font-semibold [overflow-wrap:anywhere]">
                {stop.title}
              </h3>
            </div>
            <p className="leading-relaxed [overflow-wrap:anywhere] whitespace-pre-wrap">
              {stop.summary}
            </p>
            {stop.excerpts.map((excerpt, index) => (
              <div key={`${position}:${index}`} className="min-w-0 space-y-1">
                <p className="text-text-muted font-mono text-[11px] [overflow-wrap:anywhere]">
                  {excerpt.path}:{excerpt.line}
                </p>
                <CodeReviewExcerpt
                  sessionId={sessionId}
                  reviewId={run.id}
                  path={excerpt.path}
                  line={excerpt.line}
                  side={excerpt.side}
                />
              </div>
            ))}
            {stop.files.length > 0 && (
              <div>
                <p className="text-text-muted text-[11px]">Other files in this section</p>
                <ul className="mt-1 space-y-1">
                  {stop.files.map((path) => (
                    <li key={path}>
                      <OtherFile sessionId={sessionId} reviewId={run.id} path={path} />
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {findings.length > 0 && (
              <div>
                <p className="text-text-muted text-[11px]">Findings in these files</p>
                <ul className="space-y-1">
                  {findings.map((finding) => (
                    <li key={finding.id}>
                      <button
                        type="button"
                        className="text-accent cursor-pointer text-left [overflow-wrap:anywhere] hover:underline"
                        onClick={() => {
                          const target = document.getElementById(`review-finding-${finding.id}`);
                          const parent = target?.closest('details');
                          if (parent) parent.open = true;
                          target?.scrollIntoView({ block: 'center' });
                        }}
                      >
                        {finding.severity} · {finding.title} · {finding.status}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <p className="text-text-muted text-[11px]">
              {run.evidenceCheckIds?.length ?? 0} saved checks were supplied to this review. Source
              excerpts and reading progress do not establish that a behavior passed verification.
            </p>
            {(run.verificationSummary?.total ?? 0) > 0 && (
              <button
                type="button"
                className="text-accent cursor-pointer text-[11px] hover:underline"
                onClick={() => {
                  const target = document.getElementById(
                    `review-verification-${run.id}`,
                  ) as HTMLDetailsElement | null;
                  if (target) {
                    target.open = true;
                    target.scrollIntoView({ block: 'center' });
                  }
                }}
              >
                Open review-wide verification ({run.verificationSummary!.total} checks)
              </button>
            )}
          </article>
          <div className="flex flex-wrap gap-1">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={save.isPending || position === 0}
              onClick={() => save.mutate({ action: 'navigate', position: position - 1 })}
            >
              Previous
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={save.isPending || position === tour.length - 1}
              onClick={() => save.mutate({ action: 'navigate', position: position + 1 })}
            >
              Next
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={save.isPending}
              onClick={() =>
                save.mutate({ action: 'mark', position, seen: !progress.seen.includes(position) })
              }
            >
              {progress.seen.includes(position) ? 'Mark unread' : 'Mark reviewed'}
            </Button>
            {composerActions && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={asking}
                onClick={() => {
                  void ask();
                }}
              >
                {asking ? 'Preparing…' : 'Ask about this section'}
              </Button>
            )}
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={save.isPending}
              onClick={() => save.mutate({ action: 'reset' })}
            >
              Reset progress
            </Button>
          </div>
          {(error || save.error) && (
            <p role="alert" className="text-danger [overflow-wrap:anywhere]">
              {error || save.error?.message}
            </p>
          )}
        </div>
      )}
    </details>
  );
}
