import { useCopyFeedback } from '@/shared/hooks/useCopyFeedback';
import {
  ChevronDownIcon,
  ChevronRightIcon,
  LinkExternalIcon,
  CopyIcon,
  CheckIcon,
  QuoteIcon,
  CommentIcon,
} from '@primer/octicons-react';
import {
  useState,
  useCallback,
  useMemo,
  memo,
  useRef,
  useLayoutEffect,
  type RefObject,
  type ReactNode,
} from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { DiffHunk } from '@/shared/lib/diff-parser';
import { buildSplitRows } from '@/shared/lib/diff-parser';
import { getLanguageForPath } from '@/shared/lib/code-highlighter-utils';
import { DiffLine } from './DiffLine';

import { Tooltip } from '@agentctl/ui';
import { toast } from 'sonner';
import type { ReviewComposerActions } from '../../model/composer-actions';

interface DiffBlockProps {
  annotations?: ReadonlyMap<string, ReactNode>;
  composerActions: ReviewComposerActions;
  scrollElement: RefObject<HTMLDivElement | null>;
  scrollOffset: number;
  path: string;
  hunks: DiffHunk[];
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
  onStage?: () => void;
  onRevert?: () => void;
  onOpenFile?: () => void;
  viewMode?: 'inline' | 'split';
  showHeader?: boolean;
  wrapLines?: boolean;
}

function HunkHeader({
  hunk,
  path,
  composerActions,
}: {
  hunk: DiffHunk;
  path: string;
  composerActions: ReviewComposerActions;
}) {
  return (
    <div className="group/hunk bg-surface-secondary/10 text-text-muted/30 border-border/10 flex items-center justify-between border-y px-4 py-1.5 font-mono text-[9px] select-none">
      <span className="text-text-muted/60 font-mono text-[10.5px] font-medium">{hunk.header}</span>
      <Tooltip content="Quote hunk in chat composer">
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            const maxLines = 25;
            const rawLines = hunk.lines
              .slice(0, maxLines)
              .map(
                (line) =>
                  `${line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' '}${line.content}`,
              );
            if (hunk.lines.length > maxLines)
              rawLines.push(`... (${hunk.lines.length - maxLines} more lines)`);
            composerActions.insertIntoComposer(
              `@${path} \`${hunk.header}\`:\n\`\`\`diff\n${rawLines.join('\n')}\n\`\`\``,
            );
            toast.success('Quoted hunk in chat');
          }}
          className="text-text-muted hover:text-text-main flex h-5 cursor-pointer items-center gap-1 rounded px-1.5 text-[8px] font-medium hover:bg-white/10"
        >
          <QuoteIcon className="h-3 w-3" />
          <span>Quote</span>
        </button>
      </Tooltip>
    </div>
  );
}

function DiffBody({
  annotations,
  composerActions,
  scrollElement,
  scrollOffset,
  hunks,
  path,
  language,
  hideOldLineNumber,
  hideNewLineNumber,
  viewMode,
  wrapLines,
}: {
  annotations?: ReadonlyMap<string, ReactNode>;
  scrollElement: RefObject<HTMLDivElement | null>;
  scrollOffset: number;
  hunks: DiffHunk[];
  composerActions: ReviewComposerActions;
  path: string;
  language?: string;
  hideOldLineNumber: boolean;
  hideNewLineNumber: boolean;
  viewMode: 'inline' | 'split';
  wrapLines: boolean;
}) {
  const parentRef = useRef<HTMLDivElement>(null);
  const isSplit = viewMode === 'split';
  // A file can have hundreds of small hunks. Virtualize their combined rows,
  // rather than mounting every hunk or creating one scroll observer per hunk.
  const rows = useMemo(
    () =>
      hunks.flatMap((hunk) => {
        const header = { hunk, line: null, split: null, annotation: null };
        const lines = isSplit
          ? buildSplitRows(hunk.lines).map((split) => ({
              hunk: null,
              line: null,
              split,
              annotation: null,
            }))
          : hunk.lines.map((line) => ({ hunk: null, line, split: null, annotation: null }));
        return [
          header,
          ...lines.flatMap((row) => {
            const old = row.line?.oldLineNumber ?? row.split?.left?.oldLineNumber;
            const current = row.line?.newLineNumber ?? row.split?.right?.newLineNumber;
            const additions = [
              annotations?.get(`old:${old}`),
              annotations?.get(`new:${current}`),
            ].filter((value): value is ReactNode => value != null);
            return [
              row,
              ...additions.map((annotation) => ({
                hunk: null,
                line: null,
                split: null,
                annotation,
              })),
            ];
          }),
        ];
      }),
    [hunks, isSplit, annotations],
  );
  const [scrollMargin, setScrollMargin] = useState(scrollOffset);
  useLayoutEffect(() => {
    const scroll = scrollElement.current;
    const body = parentRef.current;
    if (scroll && body) {
      setScrollMargin(
        body.getBoundingClientRect().top - scroll.getBoundingClientRect().top + scroll.scrollTop,
      );
    }
  }, [scrollElement, scrollOffset, hunks, wrapLines, viewMode]);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollElement.current,
    scrollMargin,
    // A newly mounted file shares an already-scrolled container. Starting its
    // row virtualizer at zero would reset the entire review pane on mount.
    initialOffset: () => scrollElement.current?.scrollTop ?? 0,
    estimateSize: (index) => (rows[index].annotation ? 240 : rows[index].hunk ? 32 : 18),
    overscan: 8,
    enabled: rows.length > 0,
  });
  useLayoutEffect(() => {
    virtualizer.measure();
  }, [virtualizer, wrapLines, viewMode, annotations]);
  const longestLine = useMemo(() => {
    let longest = 0;
    for (const hunk of hunks)
      for (const line of hunk.lines) {
        let columns = 0;
        let start = 0;
        for (
          let tab = line.content.indexOf('\t');
          tab !== -1;
          tab = line.content.indexOf('\t', start)
        ) {
          columns += tab - start;
          columns += 4 - (columns % 4);
          start = tab + 1;
        }
        columns += line.content.length - start;
        longest = Math.max(longest, columns);
      }
    return longest;
  }, [hunks]);
  const gutterWidth = isSplit
    ? 58
    : 30 + (hideOldLineNumber ? 0 : 28) + (hideNewLineNumber ? 0 : 28);
  const columns = isSplit ? 2 : 1;
  const minWidth = wrapLines
    ? undefined
    : `calc(${longestLine * columns}ch + ${gutterWidth * columns}px)`;
  function renderRow(index: number) {
    const row = rows[index];
    if (row.annotation)
      return (
        <div className="p-2 font-sans" style={{ maxWidth: parentRef.current?.clientWidth }}>
          {row.annotation}
        </div>
      );
    if (row.hunk)
      return <HunkHeader hunk={row.hunk} path={path} composerActions={composerActions} />;
    if (row.line)
      return (
        <DiffLine
          line={row.line}
          language={language}
          hideOldLineNumber={hideOldLineNumber}
          hideNewLineNumber={hideNewLineNumber}
          wrapLines={wrapLines}
        />
      );
    return (
      <div data-split-row className="divide-border/10 grid grid-cols-2 divide-x">
        <DiffLine
          line={row.split!.left}
          hideAdded
          language={language}
          isSpacer={!row.split!.left}
          wrapLines={wrapLines}
        />
        <DiffLine
          line={row.split!.right}
          hideRemoved
          language={language}
          isSpacer={!row.split!.right}
          wrapLines={wrapLines}
        />
      </div>
    );
  }
  return (
    <div
      ref={parentRef}
      data-diff-scroll
      className="custom-scrollbar relative overflow-x-auto py-1 font-mono text-[10.5px] [tab-size:4]"
    >
      <div className="relative w-full" style={{ minWidth, height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((item) => (
          <div
            key={item.key}
            ref={virtualizer.measureElement}
            data-index={item.index}
            className="absolute top-0 left-0 w-full"
            style={{ transform: `translateY(${item.start - scrollMargin}px)` }}
          >
            {renderRow(item.index)}
          </div>
        ))}
      </div>
    </div>
  );
}

export const DiffBlock = memo(function DiffBlock({
  annotations,
  composerActions,
  scrollElement,
  scrollOffset,
  path,
  hunks,
  isCollapsed = false,
  onToggleCollapse,
  onStage,
  onRevert,
  onOpenFile,
  viewMode = 'inline',
  showHeader = true,
  wrapLines = false,
}: DiffBlockProps) {
  const language = useMemo(() => getLanguageForPath(path), [path]);

  const stats = useMemo(() => {
    let additions = 0;
    let deletions = 0;
    for (const hunk of hunks) {
      for (const line of hunk.lines) {
        if (line.type === 'added') additions++;
        if (line.type === 'removed') deletions++;
      }
    }
    return { additions, deletions };
  }, [hunks]);

  const hasOldLineNumbers = useMemo(
    () => hunks.some((h) => h.lines.some((l) => l.oldLineNumber != null)),
    [hunks],
  );
  const hasNewLineNumbers = useMemo(
    () => hunks.some((h) => h.lines.some((l) => l.newLineNumber != null)),
    [hunks],
  );

  const { copied: copiedPath, copy } = useCopyFeedback();

  const handleCopyPath = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      copy(path);
    },
    [path, copy],
  );

  const fileName = path.split('/').pop() ?? path;
  const dirPath = path.substring(0, path.lastIndexOf('/'));

  return (
    <div className="border-border/10 bg-surface-secondary/5 hover:border-border/20 hover:bg-surface-secondary/10 group overflow-hidden rounded-lg border transition-colors duration-300">
      {showHeader && (
        <header className="border-border/10 bg-surface/40 group-hover:bg-surface/50 sticky top-0 z-10 flex items-center justify-between gap-3 border-b px-4 py-2.5 transition-colors select-none">
          <button
            type="button"
            onClick={onToggleCollapse}
            className="focus-visible:ring-accent/30 flex min-w-0 flex-1 cursor-pointer items-center gap-3 truncate rounded-md text-left outline-none focus-visible:ring-2"
          >
            <div className="text-text-muted/40 group-hover:text-accent/60 shrink-0 transition-colors">
              {isCollapsed ? (
                <ChevronRightIcon className="h-3.5 w-3.5" />
              ) : (
                <ChevronDownIcon className="h-3.5 w-3.5" />
              )}
            </div>
            <div className="flex flex-col truncate">
              <span className="text-text-main group-hover:text-accent truncate text-[11px] font-bold tracking-tight transition-colors">
                {fileName}
              </span>
              {dirPath && (
                <span className="text-text-muted/20 truncate font-mono text-[8px] tracking-tighter uppercase">
                  {dirPath}
                </span>
              )}
            </div>

            {/* Additions/Deletions Mini Badges */}
            <div className="ml-4 flex shrink-0 items-center gap-1.5 font-mono text-[8px] font-black">
              {stats.additions > 0 && (
                <div className="text-success bg-success/10 ring-success/20 flex items-center gap-1 rounded px-1.5 py-0.5 ring-1">
                  <span className="text-[7px]">+</span>
                  {stats.additions}
                </div>
              )}
              {stats.deletions > 0 && (
                <div className="text-danger bg-danger/10 ring-danger/20 flex items-center gap-1 rounded px-1.5 py-0.5 ring-1">
                  <span className="text-[7px]">-</span>
                  {stats.deletions}
                </div>
              )}
            </div>
          </button>

          <div className="flex shrink-0 items-center gap-1.5 opacity-60 transition-opacity group-hover:opacity-100">
            <Tooltip content={copiedPath ? 'Copied path!' : 'Copy path'}>
              <button
                type="button"
                onClick={handleCopyPath}
                className="text-text-muted hover:text-text-main hover:bg-surface-secondary flex h-6 w-6 cursor-pointer items-center justify-center rounded transition-colors active:scale-[0.95]"
                aria-label="Copy file path"
              >
                {copiedPath ? (
                  <CheckIcon className="text-brand-green h-3 w-3" />
                ) : (
                  <CopyIcon className="h-3 w-3" />
                )}
              </button>
            </Tooltip>

            <Tooltip content="Add to chat composer">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  composerActions.attachContextToComposer({
                    id: `file:${path}`,
                    type: 'file',
                    title: fileName,
                    subtitle: path,
                    value: path,
                  });
                  toast.success(`Added @${fileName} to chat`);
                }}
                className="text-text-muted hover:text-text-main hover:bg-surface-secondary flex h-6 w-6 cursor-pointer items-center justify-center rounded transition-colors active:scale-[0.95]"
                aria-label="Add to chat composer"
              >
                <CommentIcon className="h-3 w-3" />
              </button>
            </Tooltip>

            {onOpenFile && (
              <Tooltip content="Open in editor">
                <button
                  type="button"
                  onClick={onOpenFile}
                  className="text-text-muted hover:text-text-main hover:bg-surface-secondary flex h-6 w-6 cursor-pointer items-center justify-center rounded transition-colors active:scale-[0.95]"
                  aria-label="Open file in editor"
                >
                  <LinkExternalIcon className="h-3 w-3" />
                </button>
              </Tooltip>
            )}
            {onRevert && (
              <button
                type="button"
                onClick={onRevert}
                className="border-danger/20 bg-danger/5 text-danger hover:bg-danger/10 label-3xs flex h-6 cursor-pointer items-center rounded-md border px-2 transition-colors active:scale-[0.95]"
              >
                Revert
              </button>
            )}
            {onStage && (
              <button
                type="button"
                onClick={onStage}
                className="bg-accent text-brand-crust label-3xs flex h-6 cursor-pointer items-center rounded-md px-2 shadow-[0_0_10px_rgba(203,166,247,0.2)] transition-colors hover:opacity-90 active:scale-[0.95]"
              >
                Stage
              </button>
            )}
          </div>
        </header>
      )}

      {!isCollapsed && (
        <DiffBody
          annotations={annotations}
          composerActions={composerActions}
          scrollElement={scrollElement}
          scrollOffset={scrollOffset}
          path={path}
          hunks={hunks}
          language={language}
          hideOldLineNumber={!hasOldLineNumbers}
          hideNewLineNumber={!hasNewLineNumbers}
          viewMode={viewMode}
          wrapLines={wrapLines}
        />
      )}
    </div>
  );
});
