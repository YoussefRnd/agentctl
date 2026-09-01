import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  Input,
  Button,
} from '@agentctl/ui';
import { GitCommitIcon } from '@primer/octicons-react';

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
      <DialogContent className="max-w-sm overflow-hidden rounded-2xl p-0">
        <div className="p-5">
          <DialogHeader className="mb-4">
            <div className="bg-surface-accent text-accent ring-accent/30 mb-4 flex h-8 w-8 items-center justify-center rounded-lg shadow-[0_0_15px_rgba(203,166,247,0.2)] ring-1">
              <GitCommitIcon className="h-4 w-4" />
            </div>
            <DialogTitle className="text-text-main text-base font-semibold">
              {title ?? 'Apply changes'}
            </DialogTitle>
            <DialogDescription className="text-text-muted text-xs font-normal opacity-70">
              {description ?? 'Confirm your commit message to finalize session'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="relative">
              <div className="mb-2 flex items-center justify-between">
                <label
                  htmlFor="commit-message-input"
                  className="text-text-muted ml-1 block text-xs font-medium"
                >
                  Commit message
                </label>
                <button
                  type="button"
                  className="text-accent/80 hover:text-accent bg-accent/10 flex cursor-pointer items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium transition-colors"
                  onClick={() => {
                    onCommitMessageChange('✨ auto-generated commit message (mock)');
                  }}
                >
                  ✨ AI summary
                </button>
              </div>
              <Input
                id="commit-message-input"
                value={commitMessage}
                onChange={(e) => {
                  onCommitMessageChange(e.target.value);
                }}
                placeholder="Enter what you accomplished..."
                className="bg-background/40 border-border/10 focus:border-accent/50 focus:ring-accent/20 text-text-main h-9 w-full rounded-lg px-4 font-mono text-xs shadow-inner"
                autoFocus
              />
            </div>
          </div>
        </div>
        <div className="bg-surface-secondary/20 border-border/10 flex items-center justify-end gap-2 border-t px-5 py-3.5">
          <Button variant="ghost" onClick={onCancel} className="h-8 px-3 text-xs font-medium">
            Cancel
          </Button>
          <Button
            onClick={onConfirm}
            disabled={!commitMessage.trim()}
            className="bg-accent text-brand-crust h-8 px-4 text-xs font-medium hover:opacity-90 disabled:opacity-30"
          >
            {confirmText ?? 'Confirm apply'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
