import { memo, useState } from 'react';
import { ChevronRight, ChevronDown, FileText } from 'lucide-react';
import { useUIStore, FileIcon } from '@/shared';
import type { TurnChangesSummary } from '../../lib/turnChanges';

interface TurnChangesCardProps {
  summary: TurnChangesSummary;
  sessionId: string;
  onOpenChanges?: () => void;
}

export const TurnChangesCard = memo(function TurnChangesCard({
  summary,
  sessionId,
  onOpenChanges,
}: TurnChangesCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const setWorkbenchTab = useUIStore((s) => s.setWorkbenchTab);
  const setWorkbenchOpen = useUIStore((s) => s.setWorkbenchOpen);
  const setReviewScope = useUIStore((s) => s.setReviewScope);

  if (!summary || summary.files.length === 0) return null;

  const handleOpenReview = (e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setWorkbenchTab('changes');
    setWorkbenchOpen(true);
    setReviewScope('this_turn', {
      sessionId,
      files: summary.files.map((file) => file.path),
    });
    if (onOpenChanges) {
      onOpenChanges();
    }
  };

  const fileCount = summary.files.length;

  return (
    <div className="border-border/35 bg-surface/30 hover:border-border/50 mt-2.5 overflow-hidden rounded-xl border shadow-xs transition-colors duration-150">
      {/* Header bar */}
      <div
        onClick={() => {
          setIsExpanded((prev) => !prev);
        }}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setIsExpanded((prev) => !prev);
          }
        }}
        className="group/turn-header flex cursor-pointer items-center justify-between px-3.5 py-2.5 select-none"
      >
        {/* Left: "5 files changed +286 -129 ∨" */}
        <div className="flex items-center gap-2 text-[12.5px]">
          <span className="text-text-main font-normal">
            {fileCount} {fileCount === 1 ? 'file' : 'files'} changed
          </span>

          {(summary.totalAdditions > 0 || summary.totalDeletions > 0) && (
            <span className="flex items-center gap-1 font-mono text-[12px] font-medium">
              {summary.totalAdditions > 0 && (
                <span className="text-emerald-400">+{summary.totalAdditions}</span>
              )}
              {summary.totalDeletions > 0 && (
                <span className="text-rose-400">-{summary.totalDeletions}</span>
              )}
            </span>
          )}

          {isExpanded ? (
            <ChevronDown className="text-text-muted/60 group-hover/turn-header:text-text-main h-3.5 w-3.5 transition-colors" />
          ) : (
            <ChevronRight className="text-text-muted/60 group-hover/turn-header:text-text-main h-3.5 w-3.5 transition-colors" />
          )}
        </div>

        {/* Right: "Review" action button */}
        <button
          type="button"
          onClick={handleOpenReview}
          className="hover:text-text-main hover:bg-surface-secondary/60 text-text-muted flex cursor-pointer items-center gap-1.5 rounded-lg px-2.5 py-1 text-[12px] font-medium transition-colors"
          title="Review all changes for this turn in Changes tab"
        >
          <FileText className="h-3.5 w-3.5 opacity-80" />
          <span>Review</span>
        </button>
      </div>

      {/* Expanded File List */}
      {isExpanded && (
        <div className="border-border/20 bg-surface-secondary/15 border-t px-2 py-1.5">
          {summary.files.map((file) => {
            const fileName = file.path.split('/').pop() ?? file.path;
            const dirPath = file.path.includes('/')
              ? file.path.substring(0, file.path.lastIndexOf('/'))
              : '';

            return (
              <div
                key={file.path}
                onClick={handleOpenReview}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    handleOpenReview();
                  }
                }}
                className="hover:bg-surface/50 group/file-row flex cursor-pointer items-center justify-between rounded-lg px-2.5 py-1.5 transition-colors"
              >
                {/* Left: Icon + File Name + Directory Path */}
                <div className="flex min-w-0 flex-1 items-center gap-2 text-xs">
                  <FileIcon path={file.path} className="shrink-0" />
                  <span className="text-text-main group-hover/file-row:text-accent truncate font-mono text-[12px] font-medium">
                    {fileName}
                  </span>
                  {dirPath && (
                    <span className="text-text-muted/60 truncate font-mono text-[11px]">
                      {dirPath}
                    </span>
                  )}
                </div>

                {/* Right: Diff stats */}
                <div className="ml-3 flex shrink-0 items-center gap-1.5 font-mono text-[11.5px] font-medium">
                  {file.additions > 0 && (
                    <span className="text-emerald-400">+{file.additions}</span>
                  )}
                  {file.deletions > 0 && <span className="text-rose-400">-{file.deletions}</span>}
                  {file.additions === 0 && file.deletions === 0 && (
                    <span className="text-text-muted/60 text-[10px]">modified</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
});
