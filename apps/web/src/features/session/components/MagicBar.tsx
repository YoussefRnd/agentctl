import type { ReviewFile } from './ReviewView';
import { GitPullRequest, FileCheck } from 'lucide-react';

interface MagicBarProps {
  files: ReviewFile[];
  onAction: (action: string) => void;
}

export function MagicBar({ files, onAction }: MagicBarProps) {
  const hasChanges = files.length > 0;

  if (!hasChanges) return null;

  return (
    <div className="flex items-center gap-1.5 p-1 px-2 border-b border-white/5">
      <button
        onClick={() => {
          onAction('Generate Commit');
        }}
        className="terminal-button flex items-center gap-1.5 !bg-transparent !text-text-muted hover:!text-white border-none"
      >
        <FileCheck className="h-3 w-3" />
        <span className="text-[9px] font-black uppercase">GENERATE_COMMIT</span>
      </button>

      <button
        onClick={() => {
          onAction('Create PR');
        }}
        className="terminal-button flex items-center gap-1.5 !bg-transparent !text-text-muted hover:!text-white border-none"
      >
        <GitPullRequest className="h-3 w-3" />
        <span className="text-[9px] font-black uppercase">CREATE_PR</span>
      </button>
    </div>
  );
}

