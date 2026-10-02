import { useState, useCallback, useMemo, memo, useRef, useEffect } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { DiffHunk } from '@/shared/lib/diff-parser';
import { buildSplitRows } from '@/shared/lib/diff-parser';
import { getLanguageForPath } from '@/shared/lib/code-highlighter';
import { DiffLine } from './DiffLine';
import {
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Copy,
  Check,
  MessageSquareQuote,
  MessageSquarePlus,
} from 'lucide-react';
import { Tooltip } from '@agentctl/ui';
import { toast } from 'sonner';
import { useDraftStore } from '@/features/composer';

interface DiffBlockProps {
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

function HunkLines({
  hunk,
  language,
  hideOldLineNumber,
  hideNewLineNumber,
  viewMode,
  wrapLines,
}: {
  hunk: DiffHunk;
  language?: string;
  hideOldLineNumber: boolean;
  hideNewLineNumber: boolean;
  viewMode: 'inline' | 'split';
  wrapLines: boolean;
}) {
  const parentRef = useRef<HTMLDivElement>(null);
  const isSplit = viewMode === 'split';
  const splitRows = useMemo(
    () => (isSplit ? buildSplitRows(hunk.lines) : []),
    [hunk.lines, isSplit],
  );
  const isLarge = hunk.lines.length > 100;
  const virtualizer = useVirtualizer({
    count: isSplit ? splitRows.length : hunk.lines.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 22,
    overscan: 20,
    enabled: isLarge,
  });

  // Wrapping and split mode change row heights, including cached offscreen rows.
  useEffect(() => {
    virtualizer.measure();
  }, [virtualizer, wrapLines, viewMode]);

  const longestLine = useMemo(() => {
    let longest = 0;
    for (const line of hunk.lines) {
      let columns = 0;
      for (const character of line.content) {
        columns += character === '\t' ? 4 - (columns % 4) : 1;
      }
      longest = Math.max(longest, columns);
    }
    return longest;
  }, [hunk.lines]);
  const gutterWidth = isSplit
    ? 58
    : 30 + (hideOldLineNumber ? 0 : 28) + (hideNewLineNumber ? 0 : 28);
  const columns = isSplit ? 2 : 1;
  const minWidth = wrapLines
    ? undefined
    : `calc(${longestLine * columns}ch + ${gutterWidth * columns}px)`;

  function renderRow(index: number) {
    if (!isSplit) {
      return (
        <DiffLine
          line={hunk.lines[index]}
          language={language}
          hideOldLineNumber={hideOldLineNumber}
          hideNewLineNumber={hideNewLineNumber}
          wrapLines={wrapLines}
        />
      );
    }
    const row = splitRows[index];
    return (
      <div data-split-row className="divide-border/10 grid grid-cols-2 divide-x">
        <DiffLine
          line={row.left}
          hideAdded
          language={language}
          isSpacer={!row.left}
          wrapLines={wrapLines}
        />
        <DiffLine
          line={row.right}
          hideRemoved
          language={language}
          isSpacer={!row.right}
          wrapLines={wrapLines}
        />
      </div>
    );
  }

  return (
    <div
      ref={parentRef}
      data-diff-scroll
      className={`custom-scrollbar relative overflow-auto py-1 font-mono text-[10.5px] [tab-size:4] ${isLarge ? 'max-h-[600px]' : ''}`}
    >
      <div
        className="relative w-full"
        style={{ minWidth, height: isLarge ? virtualizer.getTotalSize() : undefined }}
      >
        {isLarge
          ? virtualizer.getVirtualItems().map((virtualItem) => (
              <div
                key={virtualItem.key}
                ref={virtualizer.measureElement}
                data-index={virtualItem.index}
                className="absolute top-0 left-0 w-full"
                style={{ transform: `translateY(${virtualItem.start}px)` }}
              >
                {renderRow(virtualItem.index)}
              </div>
            ))
          : (isSplit ? splitRows : hunk.lines).map((_, index) => (
              <div key={index}>{renderRow(index)}</div>
            ))}
      </div>
    </div>
  );
}

export const DiffBlock = memo(function DiffBlock({
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

  const [copiedPath, setCopiedPath] = useState(false);

  const handleCopyPath = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      void navigator.clipboard.writeText(path);
      setCopiedPath(true);
      setTimeout(() => {
        setCopiedPath(false);
      }, 2000);
    },
    [path],
  );

  const fileName = path.split('/').pop() ?? path;
  const dirPath = path.substring(0, path.lastIndexOf('/'));

  return (
    <div className="border-border/10 bg-surface-secondary/5 hover:border-border/20 hover:bg-surface-secondary/10 group overflow-hidden rounded-lg border backdrop-blur-md transition-colors duration-300">
      {showHeader && (
        <header className="border-border/10 bg-surface/40 group-hover:bg-surface/50 sticky top-0 z-10 flex items-center justify-between gap-3 border-b px-4 py-2.5 backdrop-blur-2xl transition-colors select-none">
          <button
            type="button"
            onClick={onToggleCollapse}
            className="focus-visible:ring-accent/30 flex min-w-0 flex-1 cursor-pointer items-center gap-3 truncate rounded-md text-left outline-none focus-visible:ring-2"
          >
            <div className="text-text-muted/40 group-hover:text-accent/60 shrink-0 transition-colors">
              {isCollapsed ? (
                <ChevronRight className="h-3.5 w-3.5" />
              ) : (
                <ChevronDown className="h-3.5 w-3.5" />
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
                  <Check className="text-brand-green h-3 w-3" />
                ) : (
                  <Copy className="h-3 w-3" />
                )}
              </button>
            </Tooltip>

            <Tooltip content="Add to chat composer">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  useDraftStore.getState().attachContextToComposer({
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
                <MessageSquarePlus className="h-3 w-3" />
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
                  <ExternalLink className="h-3 w-3" />
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
        <div className="divide-border/10 bg-background/20">
          {hunks.map((hunk) => {
            return (
              <div key={hunk.header} className="group/hunk overflow-hidden">
                <div className="bg-surface-secondary/10 text-text-muted/30 border-border/10 flex items-center justify-between border-y px-4 py-1.5 font-mono text-[9px] font-black tracking-tight uppercase select-none">
                  <div className="flex items-center gap-2">
                    <span className="text-text-muted/60 font-mono text-[10.5px] font-medium tracking-normal lowercase">
                      {hunk.header}
                    </span>
                  </div>
                  <div className="flex items-center gap-1 opacity-60 transition-opacity duration-150 group-hover/hunk:opacity-100 focus-within:opacity-100">
                    <Tooltip content="Quote hunk in chat composer">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          const maxLines = 25;
                          const rawLines = hunk.lines.slice(0, maxLines).map((l) => {
                            const prefix =
                              l.type === 'added' ? '+' : l.type === 'removed' ? '-' : ' ';
                            return `${prefix}${l.content}`;
                          });
                          if (hunk.lines.length > maxLines) {
                            rawLines.push(
                              `... (${String(hunk.lines.length - maxLines)} more lines)`,
                            );
                          }
                          const snippet = rawLines.join('\n');
                          useDraftStore
                            .getState()
                            .insertIntoComposer(
                              `@${path} \`${hunk.header}\`:\n\`\`\`diff\n${snippet}\n\`\`\``,
                            );
                          toast.success('Quoted hunk in chat');
                        }}
                        className="text-text-muted hover:text-text-main flex h-5 cursor-pointer items-center gap-1 rounded px-1.5 text-[8px] font-medium transition-colors hover:bg-white/10 active:scale-[0.95]"
                      >
                        <MessageSquareQuote className="h-3 w-3" />
                        <span>Quote</span>
                      </button>
                    </Tooltip>
                  </div>
                </div>

                <HunkLines
                  hunk={hunk}
                  language={language}
                  hideOldLineNumber={!hasOldLineNumbers}
                  hideNewLineNumber={!hasNewLineNumbers}
                  viewMode={viewMode}
                  wrapLines={wrapLines}
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
});
