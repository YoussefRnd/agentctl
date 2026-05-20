import type { ReviewFile } from './ReviewView';
import { GitPullRequest, FileCheck, Search, Eye } from 'lucide-react';

interface MagicBarProps {
  files: ReviewFile[];
  onAction: (action: string) => void;
  isReviewOpen: boolean;
  onOpenReview: () => void;
}

export function MagicBar({ files, onAction, isReviewOpen, onOpenReview }: MagicBarProps) {
  const hasChanges = files.length > 0;

  return (
    <div className="mb-2 flex items-center gap-2 p-2 px-4">
      <button
        onClick={() => {
          onOpenReview();
        }}
        className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-[12px] font-medium transition-all ${
          isReviewOpen
            ? 'bg-accent/10 border-accent text-accent'
            : 'text-text-muted hover:bg-surface-hover hover:border-border border-transparent'
        }`}
      >
        <Eye className="h-3.5 w-3.5" />
        Review Changes
      </button>

      {hasChanges && (
        <button
          onClick={() => {
            onAction('Generate Commit');
          }}
          className="text-text-muted hover:bg-surface-hover hover:border-border flex items-center gap-2 rounded-lg border border-transparent px-3 py-1.5 text-[12px] font-medium transition-all"
        >
          <FileCheck className="h-3.5 w-3.5" />
          Generate Commit
        </button>
      )}

      {hasChanges && (
        <button
          onClick={() => {
            onAction('Create PR');
          }}
          className="text-text-muted hover:bg-surface-hover hover:border-border flex items-center gap-2 rounded-lg border border-transparent px-3 py-1.5 text-[12px] font-medium transition-all"
        >
          <GitPullRequest className="h-3.5 w-3.5" />
          Create PR
        </button>
      )}

      <button
        onClick={() => {
          onAction('Investigate');
        }}
        className="text-text-muted hover:bg-surface-hover hover:border-border flex items-center gap-2 rounded-lg border border-transparent px-3 py-1.5 text-[12px] font-medium transition-all"
      >
        <Search className="h-3.5 w-3.5" />
        Investigate
      </button>
    </div>
  );
}
