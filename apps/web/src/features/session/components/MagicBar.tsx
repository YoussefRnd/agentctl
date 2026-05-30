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
        className="hover:bg-accent/10 text-accent group flex h-10 items-center gap-2 rounded-full border border-transparent px-3 transition-all duration-300"
      >
        <FileCheck className="h-3.5 w-3.5" />
        <span className="text-[11px] font-bold tracking-tight uppercase">Commit</span>
      </button>

      <button
        onClick={() => {
          onAction('Create PR');
        }}
        className="hover:bg-accent/10 text-accent group flex h-10 items-center gap-2 rounded-full border border-transparent px-3 transition-all duration-300"
      >
        <GitPullRequest className="h-3.5 w-3.5" />
        <span className="text-[11px] font-bold tracking-tight uppercase">Create PR</span>
      </button>
    </div>
  );
}
