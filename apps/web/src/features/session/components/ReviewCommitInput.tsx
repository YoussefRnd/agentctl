import { useState } from 'react';

interface ReviewCommitInputProps {
  stagedCount: number;
  onCommit: (message: string) => void;
  isCommitting?: boolean;
}

export function ReviewCommitInput({ stagedCount, onCommit, isCommitting }: ReviewCommitInputProps) {
  const [localCommitMessage, setLocalCommitMessage] = useState('');

  const handleCommit = () => {
    if (!localCommitMessage.trim() || isCommitting) return;
    onCommit(localCommitMessage);
    setLocalCommitMessage('');
  };

  return (
    <div className="border-border/10 bg-surface-secondary/15 shrink-0 space-y-3 border-t p-4">
      <div className="flex items-center justify-between">
        <span className="text-text-muted/65 text-[8px] font-black tracking-widest uppercase select-none">
          Local Commit
        </span>
        <span className="text-text-muted/40 text-[8.5px] font-bold uppercase">
          {stagedCount} file{stagedCount > 1 ? 's' : ''} staged
        </span>
      </div>
      <div className="flex gap-2">
        <input
          type="text"
          value={localCommitMessage}
          onChange={(e) => { setLocalCommitMessage(e.target.value); }}
          placeholder="Commit message (lowercase)..."
          aria-label="Commit message"
          className="border-border/15 bg-surface/20 text-text-main placeholder:text-text-muted/30 focus:border-accent/40 flex-1 rounded-md border px-3 py-1.5 text-[11px] font-bold transition-all outline-none focus:ring-0"
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleCommit();
          }}
        />
        <button
          type="button"
          disabled={!localCommitMessage.trim() || isCommitting}
          onClick={handleCommit}
          className="bg-accent text-brand-crust h-[30px] shrink-0 cursor-pointer rounded-md px-3.5 label-3xs transition-all hover:opacity-90 disabled:opacity-30"
        >
          {isCommitting ? 'Committing...' : 'Commit'}
        </button>
      </div>
    </div>
  );
}
