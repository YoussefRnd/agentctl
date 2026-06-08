import type { ReviewFile } from './ReviewView';
import { GitPullRequest, FileCheck } from 'lucide-react';

interface MagicBarProps {
  files: ReviewFile[];
  onAction: (action: string) => void;
}

const btnClass =
  'hover:bg-accent/10 text-accent flex h-8 items-center gap-2 rounded-full border border-transparent px-3 transition-[color,background-color] duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:ring-offset-1 focus-visible:ring-offset-transparent';

const labelClass = 'text-[10px] font-bold tracking-widest uppercase';

export function MagicBar({ files, onAction }: MagicBarProps) {
  const hasChanges = files.length > 0;

  if (!hasChanges) return null;

  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={() => {
          onAction('Generate Commit');
        }}
        className={btnClass}
      >
        <FileCheck className="h-3.5 w-3.5" />
        <span className={labelClass}>Commit</span>
      </button>

      <button
        type="button"
        onClick={() => {
          onAction('Create PR');
        }}
        className={btnClass}
      >
        <GitPullRequest className="h-3.5 w-3.5" />
        <span className={labelClass}>Create PR</span>
      </button>
    </div>
  );
}
