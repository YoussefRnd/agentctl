import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  Input,
  Button,
} from '@agentctl/ui';
import { Loader2, Check } from 'lucide-react';

interface ApplySessionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  baseBranch: string;
  commitMessage: string;
  onCommitMessageChange: (val: string) => void;
  onConfirm: () => Promise<void>;
}

export function ApplySessionDialog({
  open,
  onOpenChange,
  baseBranch,
  commitMessage,
  onCommitMessageChange,
  onConfirm,
}: ApplySessionDialogProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleConfirm = async () => {
    try {
      setError(null);
      setIsSubmitting(true);
      await onConfirm();
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to apply changes');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!isSubmitting) {
          setError(null);
          onOpenChange(nextOpen);
        }
      }}
    >
      <DialogContent className="max-w-md overflow-hidden p-0">
        <div className="p-5">
          <DialogHeader className="mb-4">
            <div className="bg-surface-accent text-accent ring-accent/30 mb-3 flex h-8 w-8 items-center justify-center rounded-lg shadow-[0_0_15px_rgba(203,166,247,0.2)] ring-1">
              <Check className="h-4 w-4" />
            </div>
            <DialogTitle className="text-text-main text-base font-semibold">
              Apply to {baseBranch}
            </DialogTitle>
            <DialogDescription className="text-text-muted text-xs font-normal opacity-70">
              Merge this session into <span className="font-mono">{baseBranch}</span> and finish the
              session.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="relative">
              <div className="mb-2 flex items-center">
                <label
                  htmlFor="commit-message-input"
                  className="text-text-muted ml-1 block text-xs font-medium"
                >
                  Commit message
                </label>
              </div>
              <Input
                id="commit-message-input"
                value={commitMessage}
                onChange={(e) => {
                  onCommitMessageChange(e.target.value);
                }}
                placeholder="e.g. feat(session): update review UI"
                className="bg-background/40 border-border/15 focus:border-accent/50 focus:ring-accent/20 text-text-main h-9 w-full rounded-lg px-3.5 font-mono text-xs shadow-inner"
                autoFocus
              />
            </div>
            {error && (
              <p className="bg-danger/10 border-danger/20 text-danger rounded-md border p-2 text-xs">
                {error}
              </p>
            )}
          </div>
        </div>
        <div className="bg-surface-secondary/20 border-border/10 flex items-center justify-between border-t px-5 py-3.5">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              onOpenChange(false);
            }}
            disabled={isSubmitting}
            className="h-8 px-3 text-xs font-medium"
          >
            Cancel
          </Button>

          <Button
            variant="solid"
            size="sm"
            onClick={() => {
              void handleConfirm();
            }}
            disabled={!commitMessage.trim() || isSubmitting}
            className="h-8 gap-1.5 px-3.5 text-xs font-semibold"
          >
            {isSubmitting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Check className="h-3.5 w-3.5" />
            )}
            <span>{isSubmitting ? 'Applying...' : 'Apply and finish'}</span>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
