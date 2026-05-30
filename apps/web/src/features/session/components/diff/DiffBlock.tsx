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
    <div className="border-border bg-background/50 overflow-hidden rounded-md border shadow-sm">
      <header className="border-border bg-surface-secondary/80 sticky top-0 z-10 flex items-center justify-between gap-2 border-b px-2 py-1.5 backdrop-blur-sm">
        <div className="text-text-main truncate text-[10px] font-bold tracking-tighter uppercase">
          {path}
        </div>
        <div className="flex items-center gap-1">
          {onRevert && (
            <button
              onClick={onRevert}
              className="text-text-muted hover:text-danger px-1.5 py-0.5 text-[9px] font-black uppercase transition-colors"
            >
              REVERT
            </button>
          )}
          {onStage && (
            <button
              onClick={onStage}
              className="terminal-button !bg-accent !text-background !h-6 px-2 text-[9px]"
            >
              STAGE
            </button>
          )}
        </div>
      </header>
      <div className="divide-border divide-y">
        {hunks.map((hunk, hunkIdx) => (
          <div key={hunkIdx} className="bg-surface-tertiary/20">
            <div className="bg-surface-secondary/50 text-text-muted/60 border-border border-y px-2 py-1 font-mono text-[9px] tracking-widest">
              {hunk.header}
            </div>
            <div className="py-0.5">
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
