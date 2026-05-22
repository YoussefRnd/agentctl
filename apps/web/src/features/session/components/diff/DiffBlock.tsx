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
    <div className="border-white/5 bg-black overflow-hidden rounded-sm border">
      <header className="border-white/5 bg-white/5 sticky top-0 z-10 flex items-center justify-between gap-2 border-b px-2 py-1">
        <div className="text-white truncate text-[10px] font-bold uppercase tracking-tighter">{path}</div>
        <div className="flex items-center gap-1">
          {onRevert && (
            <button
              onClick={onRevert}
              className="text-text-muted hover:text-white px-1.5 py-0.5 text-[9px] font-black uppercase transition-colors"
            >
              REVERT
            </button>
          )}
          {onStage && (
            <button
              onClick={onStage}
              className="terminal-button !h-6 px-2 text-[9px]"
            >
              STAGE
            </button>
          )}
        </div>
      </header>
      <div className="divide-white/5 divide-y">
        {hunks.map((hunk, hunkIdx) => (
          <div key={hunkIdx}>
            <div className="bg-white/[0.02] text-text-muted border-white/5 border-y px-2 py-0.5 text-[9px] font-bold tracking-widest uppercase">
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

