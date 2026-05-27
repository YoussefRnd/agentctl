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
    <div className="flex items-center gap-1">
      <button
        onClick={() => {
          onAction('Generate Commit');
        }}
        className="hover:bg-accent/10 text-accent group flex items-center gap-2 rounded-full px-3 h-10 transition-all duration-300 border border-transparent"
      >
        <FileCheck className="h-3.5 w-3.5" />
        <span className="text-[11px] font-bold uppercase tracking-tight">Commit</span>
      </button>

      <button
        onClick={() => {
          onAction('Create PR');
        }}
        className="hover:bg-accent/10 text-accent group flex items-center gap-2 rounded-full px-3 h-10 transition-all duration-300 border border-transparent"
      >
        <GitPullRequest className="h-3.5 w-3.5" />
        <span className="text-[11px] font-bold uppercase tracking-tight">Create PR</span>
      </button>
    </div>
  );
}
