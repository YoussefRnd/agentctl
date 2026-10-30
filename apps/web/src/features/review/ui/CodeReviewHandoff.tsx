import { useEffect, useRef, useState } from 'react';
import {
  Button,
  Select,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@agentctl/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useReviewChecks } from '../model/useReviewChecks';
import { fixAttemptsKey } from './CodeReviewFixAttempts';
import { createReviewFix, prepareReviewFindingHandoff } from '@agentctl/api-client';
import type { ReviewHandoff, ReviewHandoffIntent, ReviewHandoffSnippet } from '@agentctl/shared';
import type { ReviewComposerActions } from '../model/composer-actions';

function Source({
  title,
  source,
  anchor,
}: {
  title: string;
  source: ReviewHandoffSnippet;
  anchor: number | null;
}) {
  return (
    <div className="min-w-0 space-y-1">
      <p className="text-text-muted text-[11px]">{title}</p>
      {source.lines.length ? (
        <div className="border-border bg-surface max-h-48 overflow-auto rounded-md border py-1 font-mono text-[11px]">
          {source.lines.map((row) => (
            <div
              key={row.line}
              className={`flex gap-2 px-2 ${row.line === anchor ? 'bg-warning/10' : ''}`}
            >
              <span className="text-text-muted w-8 shrink-0 text-right tabular-nums">
                {row.line}
              </span>
              <code className="min-w-0 [overflow-wrap:anywhere] whitespace-pre-wrap">
                {row.text || ' '}
              </code>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-text-muted text-[11px]">
          {source.status === 'missing'
            ? 'This file is absent from the observed workspace.'
            : source.status === 'text'
              ? 'The original location could not be mapped reliably. The agent must inspect the current file.'
              : 'Source excerpt unavailable. The request states this limitation.'}
        </p>
      )}
      {source.truncated && <p className="text-text-muted text-[10px]">Excerpt is limited.</p>}
    </div>
  );
}
export function CodeReviewHandoff({
  sessionId,
  reviewId,
  findingId,
  title,
  line,
  composerActions,
  initialBaselineCheckId = null,
}: {
  sessionId: string;
  reviewId: string;
  findingId: string;
  title: string;
  line: number;
  composerActions: ReviewComposerActions;
  initialBaselineCheckId?: string | null;
}) {
  const client = useQueryClient();
  const tracked = useRef<{ key: string; id: string } | null>(null);
  const [baseline, setBaseline] = useState(initialBaselineCheckId ?? '');
  const [open, setOpen] = useState(false);
  const [intent, setIntent] = useState<ReviewHandoffIntent>('ask');
  const baselineChecks = useReviewChecks(sessionId, reviewId, open && intent === 'fix');
  const [notes, setNotes] = useState('');
  const [data, setData] = useState<ReviewHandoff | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const generation = useRef(0);
  const request = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      generation.current++;
      request.current?.abort();
    },
    [sessionId, reviewId, findingId],
  );
  const close = () => {
    generation.current++;
    request.current?.abort();
    setOpen(false);
    setBusy(false);
  };
  const prepare = async (mode: ReviewHandoffIntent, question: string, add: boolean) => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    const token = ++generation.current;
    setBusy(true);
    setError('');
    try {
      const next = await prepareReviewFindingHandoff(
        sessionId,
        reviewId,
        findingId,
        { intent: mode, notes: question },
        controller.signal,
      );
      if (generation.current !== token) return;
      setData(next);
      if (!add) return;
      if (!next.canAdd) {
        setError(next.blockedReason ?? 'The request cannot be added yet.');
        return;
      }
      if (data && JSON.stringify(data.capture) !== JSON.stringify(next.capture)) {
        setError(
          'The workspace changed while this dialog was open. Updated context is shown. Inspect it, then add the request again.',
        );
        return;
      }
      let prompt = next.prompt;
      if (mode === 'fix' && next.capture) {
        const key = JSON.stringify([question, baseline, next.capture]);
        if (tracked.current?.key !== key) tracked.current = { key, id: crypto.randomUUID() };
        const attempt = await createReviewFix(
          sessionId,
          reviewId,
          findingId,
          {
            id: tracked.current.id,
            beforeCheckId: baseline || null,
            notes: question,
            expectedCapture: next.capture,
          },
          controller.signal,
        );
        if (generation.current !== token) return;
        prompt = attempt.prompt;
        void client.invalidateQueries({ queryKey: fixAttemptsKey(sessionId, reviewId, findingId) });
      }
      composerActions.insertIntoComposer(prompt);
      close();
    } catch (cause) {
      if (generation.current === token && !controller.signal.aborted)
        setError(cause instanceof Error ? cause.message : 'Could not prepare request.');
    } finally {
      if (generation.current === token) setBusy(false);
    }
  };
  const begin = (mode: ReviewHandoffIntent) => {
    tracked.current = null;
    setBaseline(initialBaselineCheckId ?? '');
    setIntent(mode);
    setNotes('');
    setData(null);
    setOpen(true);
    void prepare(mode, '', false);
  };
  return (
    <>
      <div className="flex flex-wrap gap-1">
        <Button type="button" size="sm" variant="ghost" onClick={() => begin('ask')}>
          Ask about this
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => begin('fix')}>
          Fix this finding
        </Button>
      </div>
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!value) close();
        }}
      >
        <DialogContent
          className="max-w-2xl"
          aria-label={intent === 'ask' ? 'Ask about this finding' : 'Fix this finding'}
        >
          <DialogHeader>
            <DialogTitle className="pr-6">
              {intent === 'ask' ? 'Ask about this finding' : 'Fix this finding'}
            </DialogTitle>
            <DialogDescription>
              Prepare an editable request for the coding provider selected in this session. Use the
              normal Send action when ready.
            </DialogDescription>
          </DialogHeader>
          <p className="text-text-main text-sm font-medium [overflow-wrap:anywhere]">{title}</p>
          {busy && (
            <p role="status" className="text-text-muted text-xs">
              Checking the workspace…
            </p>
          )}
          {data && (
            <div className="space-y-3 text-xs">
              <p
                role="status"
                className={`rounded-md border px-3 py-2 leading-relaxed ${data.freshness === 'current' ? 'border-border text-text-muted' : 'border-warning/30 bg-warning/5 text-warning'}`}
              >
                {data.freshness === 'current'
                  ? 'The review matches the observed workspace.'
                  : data.freshness === 'outdated'
                    ? 'This review is outdated. The request asks the agent to re-check the current code before acting.'
                    : 'The current workspace could not be verified. Historical code remains available.'}
                {data.location === 'moved'
                  ? ` Matching code was found at current line ${data.currentLine}; the original line was ${line}.`
                  : ''}
              </p>
              {data.blockedReason && (
                <p className="text-warning leading-relaxed">{data.blockedReason}</p>
              )}
              <Source
                title={`Reviewed code · ${data.reviewed.side} side · original line ${line}`}
                source={data.reviewed}
                anchor={line}
              />
              <Source
                title={
                  data.currentLine
                    ? `Observed current code · line ${data.currentLine}`
                    : 'Observed current code · location unverified'
                }
                source={data.current}
                anchor={data.currentLine}
              />
              <p className="text-text-muted text-[11px]">
                {data.evidenceCount
                  ? `${data.evidenceCount} saved check results included with their review version.`
                  : 'No recorded check results are available for this request.'}{' '}
                {intent === 'ask'
                  ? 'The request asks for an explanation without edits.'
                  : 'A fix still needs appropriate checks and a fresh independent review.'}
              </p>
              {data.truncated && (
                <p className="text-warning text-[11px]">
                  Some history or check output was shortened to fit the request. The preview marks
                  these limits.
                </p>
              )}
              <details className="text-text-muted">
                <summary className="cursor-pointer text-[11px]">Request preview</summary>
                <pre className="bg-surface mt-2 max-h-48 overflow-auto rounded-md p-2 text-[11px] [overflow-wrap:anywhere] whitespace-pre-wrap">
                  {data.prompt}
                </pre>
              </details>
            </div>
          )}
          {intent === 'fix' && (
            <div className="space-y-2 text-xs">
              <Select
                aria-label="Fix baseline check"
                value={baseline}
                options={[
                  { value: '', label: 'Track without a failing baseline' },
                  ...(baseline && !baselineChecks.checks.some((check) => check.id === baseline)
                    ? [{ value: baseline, label: 'Previously linked reproduction check' }]
                    : []),
                  ...baselineChecks.checks
                    .filter(
                      (check) => check.status === 'failed' && check.revisionState === 'unchanged',
                    )
                    .map((check) => ({ value: check.id, label: check.name })),
                ]}
                onChange={setBaseline}
              />
              <p className="text-text-muted text-[11px]">
                A suggested fix needs a comparable failing check explicitly confirmed as reproducing
                this finding. Without that baseline, the attempt remains evidence for manual
                investigation.
              </p>
              {baselineChecks.query.hasNextPage && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    void baselineChecks.query.fetchNextPage();
                  }}
                >
                  Load older baseline checks
                </Button>
              )}
              {baselineChecks.query.isError && (
                <p role="alert" className="text-warning">
                  Could not load baseline checks.
                </p>
              )}
            </div>
          )}
          <label className="space-y-1 text-xs">
            <span>
              {intent === 'ask' ? 'Your question (optional)' : 'Additional instructions (optional)'}
            </span>
            <textarea
              aria-label="Finding request notes"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              maxLength={2000}
              rows={3}
              className="border-border bg-surface focus:border-accent w-full rounded-md border p-2 outline-none"
            />
          </label>
          {error && (
            <p role="alert" className="text-danger text-xs [overflow-wrap:anywhere]">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => {
                void prepare(intent, notes, false);
              }}
            >
              Refresh context
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy || !data || !data.canAdd}
              onClick={() => {
                void prepare(intent, notes, true);
              }}
            >
              Add to composer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
