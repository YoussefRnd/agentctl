import { RotateCcw } from 'lucide-react';
import type { RewindMode } from './RewindMenu';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  Button,
} from '@agentctl/ui';

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

const modeLabels: Record<RewindMode, string> = {
  conversation: 'REWIND CONVERSATION',
  files: 'REWIND CONVERSATION + FILES',
  fork: 'FORK FROM THIS POINT',
};

const actionVerb: Record<RewindMode, string> = {
  conversation: 'REWIND',
  files: 'REWIND',
  fork: 'FORK',
};

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
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-surface/80 ring-border/20 max-w-sm overflow-hidden rounded-xl border-none p-0 shadow-2xl ring-1 backdrop-blur-[32px]">
        <div className="p-6">
          <DialogHeader className="mb-6">
            <div className="bg-surface-accent text-accent ring-accent/30 mb-4 flex h-10 w-10 items-center justify-center rounded-lg ring-1">
              <RotateCcw className="h-5 w-5" />
            </div>
            <DialogTitle>REWIND SESSION</DialogTitle>
            <DialogDescription>{modeLabels[mode]}</DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <p className="text-text-muted text-[10px] leading-relaxed font-bold tracking-tight uppercase">
              {mode === 'fork' ? (
                <>
                  A new session will be created with the first{' '}
                  <strong className="text-text-main">{String(messageCount)}</strong> messages. The
                  original session is unchanged.
                </>
              ) : (
                <>
                  <strong className="text-text-main">{String(messageCount)}</strong> messages
                  {mode === 'files' && fileCount !== undefined
                    ? ` and <strong className="text-text-main">${String(fileCount)}</strong> files`
                    : ''}{' '}
                  will be removed. This action cannot be undone.
                </>
              )}
            </p>

            {error && (
              <div className="border-danger/20 bg-danger/5 rounded-md border p-2.5">
                <span className="text-danger text-[9px] font-black tracking-widest uppercase">
                  ERROR::
                </span>
                <span className="text-text-muted ml-1 text-[10px] font-bold">{error}</span>
              </div>
            )}
          </div>
        </div>

        <div className="bg-surface-secondary/20 border-border/10 flex items-center justify-end gap-3 border-t px-6 py-4">
          <Button
            variant="ghost"
            onClick={() => {
              onOpenChange(false);
            }}
            disabled={isLoading}
            className="h-9 px-4 text-[10px] font-black tracking-widest uppercase"
          >
            CANCEL
          </Button>
          <Button
            onClick={onConfirm}
            disabled={isLoading}
            className="h-9 px-5 text-[10px] font-black tracking-widest uppercase"
          >
            {isLoading ? 'REWINDING...' : actionVerb[mode]}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
