import { RotateCcw, Undo2, GitBranch } from 'lucide-react';
import type { RewindMode } from './RewindMenu';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  Button,
} from '@agentctl/ui';

const modeIcon: Record<RewindMode, typeof RotateCcw> = {
  conversation: RotateCcw,
  files: Undo2,
  fork: GitBranch,
};

const modeLabel: Record<RewindMode, string> = {
  conversation: 'Rewind Conversation',
  files: 'Rewind Conversation + Files',
  fork: 'Fork From This Point',
};

const actionVerb: Record<RewindMode, string> = {
  conversation: 'REWIND',
  files: 'REWIND',
  fork: 'FORK',
};

interface RewindConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: RewindMode;
  messageCount: number;
  fileCount?: number;
  onConfirm: () => void;
  isLoading?: boolean;
  error?: string | null;
}

export function RewindConfirmDialog({
  open,
  onOpenChange,
  mode,
  messageCount,
  fileCount,
  onConfirm,
  isLoading,
  error,
}: RewindConfirmDialogProps) {
  const IconComponent = modeIcon[mode];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-surface/80 ring-border/20 max-w-sm rounded-xl border-none p-0 shadow-2xl ring-1 backdrop-blur-[32px]">
        <div className="p-5">
          <DialogHeader className="mb-4">
            <div className="mb-3 flex h-8 w-8 items-center justify-center rounded-lg bg-white/5 ring-1 ring-white/10">
              <IconComponent className="text-text-muted h-4 w-4" />
            </div>
            <DialogTitle>REWIND SESSION</DialogTitle>
            <DialogDescription>{modeLabel[mode]}</DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="text-text-muted text-[10px] leading-relaxed font-bold tracking-tight">
              {mode === 'fork' ? (
                <p>
                  A new session will be created with the first{' '}
                  <strong className="text-text-main">{String(messageCount)}</strong> messages. The
                  original session is unchanged.
                </p>
              ) : (
                <p>
                  <strong className="text-text-main">{String(messageCount)}</strong> messages
                  {mode === 'files' && fileCount !== undefined
                    ? ` and ${String(fileCount)} files`
                    : ''}{' '}
                  will be removed. This action cannot be undone.
                </p>
              )}
            </div>

            {error && (
              <div className="border-danger/20 bg-danger/5 rounded-md border p-2">
                <span className="text-danger label-3xs">ERROR: </span>
                <span className="text-text-muted text-[10px] font-bold">{error}</span>
              </div>
            )}
          </div>
        </div>

        <div className="bg-surface-secondary/20 border-border/10 flex items-center justify-end gap-2 border-t px-5 py-3.5">
          <Button
            variant="ghost"
            onClick={() => {
              onOpenChange(false);
            }}
            disabled={isLoading}
            className="h-8 px-3 label-2xs"
          >
            CANCEL
          </Button>
          <Button
            onClick={onConfirm}
            disabled={isLoading}
            className="h-8 px-4 label-2xs"
          >
            {isLoading ? 'REWINDING...' : actionVerb[mode]}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
