import { useState } from 'react';

export interface ReviewCommitStatus {
  isCommitting?: boolean;
  isStagingAll?: boolean;
  isUnstagingAll?: boolean;
  isMerging?: boolean;
  isDiscarding?: boolean;
  hasUnstaged?: boolean;
  hasChanges?: boolean;
}

interface ReviewCommitInputProps {
  stagedCount: number;
  onCommit: (message: string) => void;
  onStageAll?: () => void;
  onUnstageAll?: () => void;
  onMergeSession?: () => void;
  onDiscardChanges?: () => void;
  status?: ReviewCommitStatus;
}

export function ReviewCommitInput({
  stagedCount,
  onCommit,
  onStageAll,
  onUnstageAll,
  onMergeSession,
  onDiscardChanges,
  status = {},
}: ReviewCommitInputProps) {
  const {
    isCommitting,
    isStagingAll,
    isUnstagingAll,
    isMerging,
    isDiscarding,
    hasUnstaged,
    hasChanges = true,
  } = status;
  const [localCommitMessage, setLocalCommitMessage] = useState('');

  const handleCommit = () => {
    if (!localCommitMessage.trim() || isCommitting) return;
    onCommit(localCommitMessage);
    setLocalCommitMessage('');
  };

  return (
    <div className="border-border/10 bg-surface-secondary/15 shrink-0 space-y-3 border-t p-3.5">
      <div className="flex items-center justify-between">
        <span className="text-text-muted/70 text-xs font-medium select-none">Local commit</span>
        <span className="text-text-muted/60 text-xs font-normal">
          {stagedCount} file{stagedCount > 1 ? 's' : ''} staged
        </span>
      </div>

      <div className="flex items-center gap-2">
        <input
          type="text"
          value={localCommitMessage}
          onChange={(e) => {
            setLocalCommitMessage(e.target.value);
          }}
          placeholder="Commit message..."
          aria-label="Commit message"
          className="border-border/15 bg-surface/20 text-text-main placeholder:text-text-muted/40 focus:border-accent/40 flex-1 rounded-md border px-3 py-1.5 text-xs font-normal transition-colors outline-none"
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleCommit();
          }}
        />
        <button
          type="button"
          disabled={!localCommitMessage.trim() || isCommitting}
          onClick={handleCommit}
          className="bg-accent text-brand-crust h-8 shrink-0 cursor-pointer rounded-md px-3 text-xs font-medium transition-colors hover:opacity-90 disabled:opacity-30"
        >
          {isCommitting ? 'Committing...' : 'Commit'}
        </button>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
        <div className="flex items-center gap-1.5">
          {onStageAll && (
            <button
              type="button"
              disabled={!hasUnstaged || isStagingAll}
              onClick={onStageAll}
              className="border-border/15 bg-surface-tertiary/20 text-text-muted hover:text-text-main hover:bg-surface-tertiary/30 h-7 cursor-pointer rounded-md border px-2.5 text-xs font-medium transition-colors disabled:cursor-default disabled:opacity-30"
            >
              {isStagingAll ? 'Staging...' : 'Stage All'}
            </button>
          )}
          {onUnstageAll && (
            <button
              type="button"
              disabled={stagedCount === 0 || isUnstagingAll}
              onClick={onUnstageAll}
              className="border-border/15 bg-surface-tertiary/20 text-text-muted hover:text-text-main hover:bg-surface-tertiary/30 h-7 cursor-pointer rounded-md border px-2.5 text-xs font-medium transition-colors disabled:cursor-default disabled:opacity-30"
            >
              {isUnstagingAll ? 'Unstaging...' : 'Unstage All'}
            </button>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          {onDiscardChanges && (
            <button
              type="button"
              disabled={!hasChanges || (isMerging ?? false) || (isDiscarding ?? false)}
              onClick={onDiscardChanges}
              className="border-danger/20 bg-danger/10 text-danger hover:bg-danger/20 h-7 cursor-pointer rounded-md border px-2.5 text-xs font-medium transition-colors disabled:cursor-default disabled:opacity-30"
            >
              Discard Changes
            </button>
          )}
          {onMergeSession && (
            <button
              type="button"
              disabled={!hasChanges || (isMerging ?? false) || (isDiscarding ?? false)}
              onClick={onMergeSession}
              className="bg-accent/15 text-accent border-accent/30 hover:bg-accent/25 h-7 cursor-pointer rounded-md border px-2.5 text-xs font-medium transition-colors disabled:cursor-default disabled:opacity-30"
            >
              {isMerging ? 'Merging...' : 'Merge Session'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
