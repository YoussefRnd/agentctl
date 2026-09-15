import { useState, useCallback, useMemo, memo, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { DiffHunk } from '@/shared/lib/diff-parser';
import { buildSplitRows } from '@/shared/lib/diff-parser';
import { getLanguageForPath } from '@/shared/lib/code-highlighter';
import { DiffLine } from './DiffLine';
import {
  ChevronDown,
  ChevronRight,
  CheckSquare,
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
}

function VirtualizedInlineHunk({
  hunk,
  language,
  hideOldLineNumber,
  hideNewLineNumber,
}: {
  hunk: DiffHunk;
  language?: string;
  hideOldLineNumber?: boolean;
  hideNewLineNumber?: boolean;
}) {
  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: hunk.lines.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 22,
    overscan: 20,
  });

  return (
    <div ref={parentRef} className="custom-scrollbar relative max-h-[600px] overflow-y-auto py-1">
      <div className="relative w-full" style={{ height: `${virtualizer.getTotalSize()}px` }}>
        {virtualizer.getVirtualItems().map((virtualItem) => {
          const line = hunk.lines[virtualItem.index];
          return (
            <div
              key={virtualItem.key}
              ref={virtualizer.measureElement}
              data-index={virtualItem.index}
              className="absolute top-0 left-0 w-full"
              style={{
                transform: `translateY(${virtualItem.start}px)`,
              }}
            >
              <DiffLine
                line={line}
                language={language}
                hideOldLineNumber={hideOldLineNumber}
                hideNewLineNumber={hideNewLineNumber}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function VirtualizedSplitHunk({
  splitRows,
  language,
}: {
  splitRows: ReturnType<typeof buildSplitRows>;
  language?: string;
}) {
  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: splitRows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 22,
    overscan: 20,
  });

  return (
    <div ref={parentRef} className="custom-scrollbar relative max-h-[600px] overflow-y-auto py-1">
      <div className="relative w-full" style={{ height: `${virtualizer.getTotalSize()}px` }}>
        {virtualizer.getVirtualItems().map((virtualItem) => {
          const row = splitRows[virtualItem.index];
          return (
            <div
              key={virtualItem.key}
              ref={virtualizer.measureElement}
              data-index={virtualItem.index}
              className="divide-border/10 absolute top-0 left-0 flex w-full divide-x overflow-x-auto"
              style={{
                transform: `translateY(${virtualItem.start}px)`,
              }}
            >
              <div className="min-w-0 flex-1">
                <DiffLine line={row.left} hideAdded language={language} isSpacer={!row.left} />
              </div>
              <div className="min-w-0 flex-1">
                <DiffLine line={row.right} hideRemoved language={language} isSpacer={!row.right} />
              </div>
            </div>
          );
        })}
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
            const splitRows = viewMode === 'split' ? buildSplitRows(hunk.lines) : [];
            const isLarge = hunk.lines.length > 100;

            return (
              <div key={hunk.header} className="group/hunk overflow-hidden">
                <div className="bg-surface-secondary/10 text-text-muted/30 border-border/10 flex items-center justify-between border-y px-4 py-1.5 font-mono text-[9px] font-black tracking-tight uppercase select-none">
                  <div className="flex items-center gap-2">
                    <span className="text-text-muted/60 font-mono text-[10.5px] font-medium tracking-normal lowercase">
                      {hunk.header}
                    </span>
                  </div>
                  <div className="flex items-center gap-1 opacity-0 transition-opacity duration-150 group-hover/hunk:opacity-100">
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

                    {onStage && (
                      <Tooltip content="Stage changes">
                        <button
                          type="button"
                          onClick={onStage}
                          className="bg-accent/10 text-accent hover:bg-accent/20 flex h-5 cursor-pointer items-center gap-1 rounded px-1.5 text-[8px] font-black transition-colors"
                        >
                          <CheckSquare className="h-3 w-3" />
                          <span>Stage</span>
                        </button>
                      </Tooltip>
                    )}
                  </div>
                </div>

                {isLarge ? (
                  viewMode === 'inline' ? (
                    <VirtualizedInlineHunk
                      hunk={hunk}
                      language={language}
                      hideOldLineNumber={!hasOldLineNumbers}
                      hideNewLineNumber={!hasNewLineNumbers}
                    />
                  ) : (
                    <VirtualizedSplitHunk splitRows={splitRows} language={language} />
                  )
                ) : (
                  <div className="py-1">
                    {viewMode === 'inline' ? (
                      hunk.lines.map((line) => (
                        <DiffLine
                          key={`${String(line.oldLineNumber ?? '')}-${String(line.newLineNumber ?? '')}-${line.type}-${line.content}`}
                          line={line}
                          language={language}
                          hideOldLineNumber={!hasOldLineNumbers}
                          hideNewLineNumber={!hasNewLineNumbers}
                        />
                      ))
                    ) : (
                      /* Horizontally aligned Split View with Spacers */
                      <div className="divide-border/10 flex divide-x overflow-x-auto">
                        <div className="min-w-0 flex-1">
                          {splitRows.map((row, rIdx) => (
                            <DiffLine
                              key={`left-${String(rIdx)}-${String(row.left?.oldLineNumber ?? '')}`}
                              line={row.left}
                              hideAdded
                              language={language}
                              isSpacer={!row.left}
                            />
                          ))}
                        </div>
                        <div className="min-w-0 flex-1">
                          {splitRows.map((row, rIdx) => (
                            <DiffLine
                              key={`right-${String(rIdx)}-${String(row.right?.newLineNumber ?? '')}`}
                              line={row.right}
                              hideRemoved
                              language={language}
                              isSpacer={!row.right}
                            />
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
});
