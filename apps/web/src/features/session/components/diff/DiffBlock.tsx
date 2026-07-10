import { useMemo, memo } from 'react';
import type { DiffHunk } from '../../../../utils/diff-parser';
import { DiffLine } from './DiffLine';
import { ChevronDown, ChevronRight, CheckSquare } from 'lucide-react';

interface DiffBlockProps {
  path: string;
  hunks: DiffHunk[];
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
  onStage?: () => void;
  onRevert?: () => void;
  viewMode?: 'inline' | 'split';
  showHeader?: boolean;
}

export const DiffBlock = memo(function DiffBlock({
  path,
  hunks,
  isCollapsed = false,
  onToggleCollapse,
  onStage,
  onRevert,
  viewMode = 'inline',
  showHeader = true,
}: DiffBlockProps) {
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

  const fileName = path.split('/').pop() ?? path;
  const dirPath = path.substring(0, path.lastIndexOf('/'));

  return (
    <div className="group border-border/10 bg-surface-secondary/5 hover:border-border/20 hover:bg-surface-secondary/10 overflow-hidden rounded-lg border backdrop-blur-md transition-all duration-300">
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

          <div className="flex shrink-0 items-center gap-2 opacity-40 transition-opacity group-hover:opacity-100">
            {onRevert && (
              <button
                type="button"
                onClick={onRevert}
                className="border-danger/20 bg-danger/5 text-danger hover:bg-danger/10 flex h-6 cursor-pointer items-center rounded-md border px-2 label-3xs transition-all"
              >
                Revert
              </button>
            )}
            {onStage && (
              <button
                type="button"
                onClick={onStage}
                className="bg-accent text-brand-crust flex h-6 cursor-pointer items-center rounded-md px-2 label-3xs shadow-[0_0_10px_rgba(203,166,247,0.2)] transition-all hover:opacity-90"
              >
                Stage
              </button>
            )}
          </div>
        </header>
      )}

      {!isCollapsed && (
        <div className="divide-border/10 bg-background/20">
          {hunks.map((hunk) => (
            <div key={hunk.header} className="group/hunk overflow-hidden">
              <div className="bg-surface-secondary/10 text-text-muted/30 border-border/10 flex items-center justify-between border-y px-4 py-1.5 font-mono text-[9px] font-black tracking-tight uppercase select-none">
                <div className="flex items-center gap-2">
                  <span className="text-accent/30 text-[12px]">@@</span> {hunk.header}
                </div>
                {onStage && (
                  <button
                    type="button"
                    onClick={onStage}
                    className="bg-accent/10 text-accent hover:bg-accent/20 flex h-5 cursor-pointer items-center gap-1.5 rounded px-1.5 text-[8px] font-black opacity-0 transition-all group-hover/hunk:opacity-100"
                    title="Stage Hunk"
                  >
                    <CheckSquare className="h-3 w-3" />
                    Stage Hunk
                  </button>
                )}
              </div>
              <div className="py-1">
                {viewMode === 'inline' ? (
                  hunk.lines.map((line) => (
                    <DiffLine
                      key={`${String(line.oldLineNumber ?? '')}-${String(line.newLineNumber ?? '')}-${line.type}-${line.content}`}
                      line={line}
                    />
                  ))
                ) : (
                  /* Split View Rendering */
                  <div className="divide-border/10 flex divide-x">
                    <div className="min-w-0 flex-1">
                      {hunk.lines.reduce<React.ReactNode[]>((acc, line) => {
                        if (line.type !== 'added') {
                          acc.push(
                            <DiffLine
                              key={`old-${String(line.oldLineNumber ?? '')}-${line.content}`}
                              line={line}
                              hideAdded
                            />,
                          );
                        }
                        return acc;
                      }, [])}
                    </div>
                    <div className="min-w-0 flex-1">
                      {hunk.lines.reduce<React.ReactNode[]>((acc, line) => {
                        if (line.type !== 'removed') {
                          acc.push(
                            <DiffLine
                              key={`new-${String(line.newLineNumber ?? '')}-${line.content}`}
                              line={line}
                              hideRemoved
                            />,
                          );
                        }
                        return acc;
                      }, [])}
                    </div>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
});
