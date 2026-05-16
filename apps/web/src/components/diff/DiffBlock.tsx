import type { DiffHunk } from '../../utils/diff-parser';
import { DiffLine } from './DiffLine';

interface DiffBlockProps {
  path: string;
  hunks: DiffHunk[];
  onStage?: () => void;
  onRevert?: () => void;
}

export function DiffBlock({ path, hunks, onStage, onRevert }: DiffBlockProps) {
  return (
    <div className="rounded border border-border bg-background overflow-hidden">
      <header className="sticky top-0 z-10 flex items-center justify-between gap-3 px-3 py-2 bg-surface border-b border-border">
        <div className="font-mono text-xs font-medium text-text-main truncate">
          {path}
        </div>
        <div className="flex items-center gap-2">
          {onRevert && (
            <button
              onClick={onRevert}
              className="px-2 py-1 text-[10px] uppercase tracking-wider font-bold rounded border border-border hover:bg-surface-hover text-text-muted transition-colors"
            >
              Revert
            </button>
          )}
          {onStage && (
            <button
              onClick={onStage}
              className="px-2 py-1 text-[10px] uppercase tracking-wider font-bold rounded border border-border bg-text-main text-background hover:opacity-90 transition-opacity"
            >
              Stage
            </button>
          )}
        </div>
      </header>
      <div className="divide-y divide-border/20">
        {hunks.map((hunk, hunkIdx) => (
          <div key={hunkIdx}>
            <div className="px-3 py-1 bg-surface/30 font-mono text-[10px] text-text-muted border-y border-border/10">
              {hunk.header}
            </div>
            <div className="py-1">
              {hunk.lines.map((line, lineIdx) => (
                <DiffLine key={lineIdx} line={line} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
