import { useState } from 'react';

export interface ReviewCommitStatus {
  isCommitting?: boolean;
  isMerging?: boolean;
  isDiscarding?: boolean;
  hasChanges?: boolean;
}

interface ReviewCommitInputProps {
  stagedCount: number;
  onCommit: (message: string) => void;
  onMergeSession?: () => void;
  onDiscardChanges?: () => void;
  status?: ReviewCommitStatus;
}

export function ReviewCommitInput({
  stagedCount,
  onCommit,
  onMergeSession,
  onDiscardChanges,
  status = {},
}: ReviewCommitInputProps) {
  const { isCommitting, isMerging, isDiscarding, hasChanges = true } = status;
  const [localCommitMessage, setLocalCommitMessage] = useState('');

  const handleCommit = () => {
    if (!localCommitMessage.trim() || isCommitting) return;
    onCommit(localCommitMessage);
    setLocalCommitMessage('');
  };

  return (
    <div className="border-border/10 bg-surface-secondary/20 shrink-0 space-y-2 border-t p-3">
      {/* Commit Input */}
      <div className="flex items-center gap-1.5">
        <input
          type="text"
          value={localCommitMessage}
          onChange={(e) => {
            setLocalCommitMessage(e.target.value);
          }}
          placeholder={
            stagedCount > 0
              ? `Commit message (${stagedCount} staged)...`
              : 'Stage files to commit locally...'
          }
          aria-label="Commit message"
          className="border-border/15 bg-surface-secondary/30 text-text-main placeholder:text-text-muted/40 focus:border-accent/40 h-7 flex-1 rounded-md border px-2.5 text-xs font-normal transition-colors outline-none"
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleCommit();
          }}
        />
        <button
          type="button"
          disabled={!localCommitMessage.trim() || stagedCount === 0 || isCommitting}
          onClick={handleCommit}
          className="bg-surface-tertiary/40 hover:bg-surface-tertiary/70 text-text-main border-border/20 h-7 shrink-0 cursor-pointer rounded-md border px-2.5 text-xs font-medium transition-colors disabled:cursor-default disabled:opacity-30"
        >
          {isCommitting ? 'Committing...' : 'Commit'}
        </button>
      </div>

      {/* Primary Session Actions: Discard & Merge */}
      <div className="flex items-center justify-between pt-0.5">
        <div>
          {onDiscardChanges && (
            <button
              type="button"
              disabled={!hasChanges || (isMerging ?? false) || (isDiscarding ?? false)}
              onClick={onDiscardChanges}
              className="text-danger/80 hover:text-danger hover:bg-danger/10 flex h-7 cursor-pointer items-center rounded-md px-2 text-xs font-medium transition-colors disabled:cursor-default disabled:opacity-30"
            >
              Discard changes...
            </button>
          )}
        </div>

        <div>
          {onMergeSession && (
            <button
              type="button"
              disabled={!hasChanges || (isMerging ?? false) || (isDiscarding ?? false)}
              onClick={onMergeSession}
              className="bg-accent text-brand-crust flex h-7 cursor-pointer items-center rounded-md px-3.5 text-xs font-semibold transition-opacity hover:opacity-90 disabled:cursor-default disabled:opacity-30"
            >
              {isMerging ? 'Merging...' : 'Merge session'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
