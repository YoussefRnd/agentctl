import type { DiffHunk } from '../../../../utils/diff-parser';
import { DiffLine } from './DiffLine';

interface DiffBlockProps {
  path: string;
  hunks: DiffHunk[];
  onStage?: () => void;
  onRevert?: () => void;
}

export function DiffBlock({ path, hunks, onStage, onRevert }: DiffBlockProps) {
  return (
    <div className="border-border bg-background overflow-hidden rounded border">
      <header className="bg-surface border-border sticky top-0 z-10 flex items-center justify-between gap-3 border-b px-3 py-2">
        <div className="text-text-main truncate font-mono text-xs font-medium">{path}</div>
        <div className="flex items-center gap-2">
          {onRevert && (
            <button
              onClick={onRevert}
              className="border-border hover:bg-surface-hover text-text-muted rounded border px-2 py-1 text-[10px] font-bold tracking-wider uppercase transition-colors"
            >
              Revert
            </button>
          )}
          {onStage && (
            <button
              onClick={onStage}
              className="border-border bg-text-main text-background rounded border px-2 py-1 text-[10px] font-bold tracking-wider uppercase transition-opacity hover:opacity-90"
            >
              Stage
            </button>
          )}
        </div>
      </header>
      <div className="divide-border/20 divide-y">
        {hunks.map((hunk, hunkIdx) => (
          <div key={hunkIdx}>
            <div className="bg-surface/30 text-text-muted border-border/10 border-y px-3 py-1 font-mono text-[10px]">
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
