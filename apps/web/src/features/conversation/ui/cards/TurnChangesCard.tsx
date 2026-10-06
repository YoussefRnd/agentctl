import { ChangedFileRow } from '../ChangedFileRow';
import { memo, useState } from 'react';
import { ChevronRight, ChevronDown } from 'lucide-react';
import { useOpenWorkspaceFile } from '@/features/sessions';
import { useReviewUIStore, type TurnChangesSummary } from '@/features/review';
import { useWorkbenchStore } from '@/features/workbench';

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
  const setWorkbenchTab = useWorkbenchStore((s) => s.setWorkbenchTab);
  const setWorkbenchOpen = useWorkbenchStore((s) => s.setWorkbenchOpen);
  const setReviewScope = useReviewUIStore((s) => s.setReviewScope);
  const focusReviewFile = useReviewUIStore((s) => s.focusReviewFile);
  const openWorkspaceFile = useOpenWorkspaceFile();

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

  const handleOpenFileReview = (filePath: string) => {
    setWorkbenchTab('changes');
    setWorkbenchOpen(true);
    focusReviewFile(filePath, {
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
          className="hover:text-text-main hover:bg-surface-secondary/60 text-text-muted flex cursor-pointer items-center rounded-md px-2 py-1 text-[12px] font-medium transition-colors"
          title="Review all changes for this turn in Changes tab"
        >
          Review
        </button>
      </div>

      {/* Expanded File List */}
      {isExpanded && (
        <div className="border-border/20 bg-surface-secondary/15 border-t px-2 py-1.5">
          {summary.files.map((file) => (
            <ChangedFileRow
              key={file.path}
              file={file}
              onReview={handleOpenFileReview}
              onOpenEditor={openWorkspaceFile}
              emptyStatus="modified"
              editorButtonClassName="text-text-muted/40 hover:text-text-main hover:bg-surface-tertiary/60 mr-2 flex h-5.5 w-5.5 cursor-pointer items-center justify-center rounded opacity-0 transition-[opacity,color,background-color] duration-150 group-hover/file-row:opacity-100 focus-visible:opacity-100 active:scale-[0.97]"
            />
          ))}
        </div>
      )}
    </div>
  );
});
