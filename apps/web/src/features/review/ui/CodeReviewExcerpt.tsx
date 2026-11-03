import { LoadingState } from '@agentctl/ui';
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getCodeReviewFile } from '@agentctl/api-client';
import { sessionKeys } from '@/shared/lib/queryKeys';
import { parseDiff } from '@/shared/lib/diff-parser';

export function CodeReviewExcerpt({
  sessionId,
  reviewId,
  path,
  line,
  side,
  firstChange = false,
}: {
  sessionId: string;
  reviewId: string;
  path: string;
  line: number;
  side?: 'old' | 'new';
  firstChange?: boolean;
}) {
  const [radius, setRadius] = useState(3);
  const query = useQuery({
    queryKey: sessionKeys.codeReviewFile(sessionId, reviewId, path),
    queryFn: ({ signal }) => getCodeReviewFile(sessionId, reviewId, path, signal),
    staleTime: (query) => (query.state.data?.source === 'saved' ? Infinity : 30000),
  });
  const excerpt = useMemo(() => {
    const file = query.data?.file;
    if (!file) return null;
    const hunks = parseDiff(file.diff, { highlightWords: false });
    const oldSide = side
      ? side === 'old'
      : file.state === 'deleted' ||
        (firstChange &&
          !hunks.some((hunk) => hunk.lines.some((row) => row.newLineNumber !== undefined)));
    const target = firstChange
      ? hunks[0]?.lines.find(
          (row) => (oldSide ? row.oldLineNumber : row.newLineNumber) !== undefined,
        )
      : undefined;
    const anchorLine = firstChange
      ? oldSide
        ? target?.oldLineNumber
        : target?.newLineNumber
      : line;
    if (anchorLine === undefined) return null;
    for (const hunk of hunks) {
      const index = hunk.lines.findIndex(
        (row) => (oldSide ? row.oldLineNumber : row.newLineNumber) === anchorLine,
      );
      if (index < 0) continue;
      const start = Math.max(0, index - radius);
      const end = Math.min(hunk.lines.length, index + radius + 1);
      return {
        rows: hunk.lines.slice(start, end),
        oldSide,
        start,
        end,
        length: hunk.lines.length,
        anchorLine,
      };
    }
    return null;
  }, [query.data, line, radius, side, firstChange]);
  if (query.isPending) return <LoadingState variant="inline" message="Loading captured code…" />;
  if (query.isError)
    return (
      <p role="alert" className="text-warning text-[11px]">
        Could not load captured code.{' '}
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
    );
  if (!excerpt)
    return (
      <p className="text-text-muted text-[11px]">
        Captured code is unavailable for this finding. Its original location and explanation remain
        saved.{' '}
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
    );
  return (
    <div
      aria-label={`Captured code for ${path}:${line}`}
      className="border-border/40 min-w-0 overflow-hidden rounded-md border"
    >
      <div className="bg-surface/60 text-text-muted flex flex-wrap items-center justify-between gap-1 px-2 py-1.5 text-[10px]">
        <span>Captured code · {excerpt.oldSide ? 'old side' : 'new side'}</span>
        <span>Highlighted line {excerpt.anchorLine}</span>
      </div>
      <div className="bg-surface/20 overflow-x-auto py-1 font-mono text-[11px]">
        {excerpt.rows.map((row, index) => {
          const number = excerpt.oldSide ? row.oldLineNumber : row.newLineNumber;
          const anchor = number === excerpt.anchorLine;
          return (
            <div
              key={index}
              data-review-anchor={anchor || undefined}
              aria-label={
                anchor ? `Finding at ${excerpt.oldSide ? 'old' : 'new'} line ${line}` : undefined
              }
              className={`flex min-w-0 border-l-2 ${anchor ? 'border-warning bg-warning/15' : row.type === 'added' ? 'bg-brand-teal/5 border-transparent' : row.type === 'removed' ? 'bg-danger/5 border-transparent' : 'border-transparent'}`}
            >
              <span
                aria-hidden="true"
                className="text-text-muted w-9 shrink-0 pr-1 text-right tabular-nums select-none"
              >
                {row.oldLineNumber ?? ''}
              </span>
              <span
                aria-hidden="true"
                className="text-text-muted w-9 shrink-0 pr-1 text-right tabular-nums select-none"
              >
                {row.newLineNumber ?? ''}
              </span>
              <span
                aria-hidden="true"
                className={`w-4 shrink-0 select-none ${row.type === 'added' ? 'text-brand-teal' : row.type === 'removed' ? 'text-danger' : 'text-text-muted'}`}
              >
                {row.type === 'added' ? '+' : row.type === 'removed' ? '-' : ' '}
              </span>
              <code className="text-text-main min-w-0 flex-1 pr-2 [overflow-wrap:anywhere] whitespace-pre-wrap">
                {row.content || ' '}
              </code>
            </div>
          );
        })}
      </div>
      <div className="text-text-muted flex flex-wrap justify-between gap-2 px-2 py-1.5 text-[10px]">
        <span>Saved review version</span>
        {(excerpt.start > 0 || excerpt.end < excerpt.length) && radius < 51 ? (
          <button
            type="button"
            className="text-accent cursor-pointer hover:underline"
            onClick={() => setRadius(radius + 12)}
          >
            More context
          </button>
        ) : null}
        {radius > 3 && (
          <button
            type="button"
            className="cursor-pointer hover:underline"
            onClick={() => setRadius(3)}
          >
            Less context
          </button>
        )}
      </div>
    </div>
  );
}
