import { GitCommit } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  Input,
} from '@agentctl/ui';

interface ReviewMergeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  commitMessage: string;
  onCommitMessageChange: (val: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
  title?: string;
  description?: string;
  confirmText?: string;
}

export function ReviewMergeDialog({
  open,
  onOpenChange,
  commitMessage,
  onCommitMessageChange,
  onCancel,
  onConfirm,
  title,
  description,
  confirmText,
}: ReviewMergeDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-surface/80 ring-border/20 max-w-sm overflow-hidden rounded-xl border-none p-0 shadow-2xl ring-1 backdrop-blur-[32px]">
        <div className="p-5">
          <DialogHeader className="mb-4">
            <div className="bg-surface-accent text-accent ring-accent/30 mb-4 flex h-8 w-8 items-center justify-center rounded-lg shadow-[0_0_15px_rgba(203,166,247,0.2)] ring-1">
              <GitCommit className="h-4 w-4" />
            </div>
            <DialogTitle className="text-text-main text-lg font-black tracking-tight uppercase">
              {title ?? 'Apply Changes'}
            </DialogTitle>
            <DialogDescription className="text-[10px] font-bold tracking-[0.15em] uppercase opacity-50">
              {description ?? 'Confirm your commit message to finalize session'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="relative">
              <div className="mb-2 flex items-center justify-between">
                <label
                  htmlFor="commit-message-input"
                  className="text-text-muted/60 ml-1 block text-[9px] font-black tracking-[0.2em] uppercase"
                >
                  Commit Message
                </label>
                <button
                  type="button"
                  className="text-accent/80 hover:text-accent bg-accent/10 flex cursor-pointer items-center gap-1 rounded-full px-2 py-0.5 text-[8px] font-black tracking-widest uppercase transition-colors"
                  onClick={() => {
                    onCommitMessageChange('✨ auto-generated commit message (mock)');
                  }}
                >
                  ✨ AI Summary
                </button>
              </div>
              <Input
                id="commit-message-input"
                value={commitMessage}
                onChange={(e) => {
                  onCommitMessageChange(e.target.value);
                }}
                placeholder="Enter what you accomplished..."
                className="bg-background/40 border-border/10 focus:border-accent/50 focus:ring-accent/20 text-text-main h-9 w-full rounded-lg px-4 font-mono text-[12px] shadow-inner"
                autoFocus
              />
            </div>
          </div>
        </div>
        <div className="bg-surface-secondary/20 border-border/10 flex items-center justify-end gap-2 border-t px-5 py-3.5">
          <button
            type="button"
            onClick={onCancel}
            className="text-text-muted/60 hover:text-text-main h-9 cursor-pointer px-4 label-2xs transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={!commitMessage.trim()}
            className="bg-accent text-brand-crust flex h-9 cursor-pointer items-center rounded-lg px-5 label-2xs shadow-[0_0_15px_rgba(203,166,247,0.3)] transition-all hover:opacity-90 disabled:cursor-default disabled:opacity-20"
          >
            {confirmText ?? 'Confirm Apply'}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
