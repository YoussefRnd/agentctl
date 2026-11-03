import { RotateCcw, Undo2, FileText, CheckCircle, AlertCircle } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import type { RewindMode } from './RewindMenu';
import { previewSnapshotDiff } from '@agentctl/api-client';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  Button,
  Badge,
  Spinner,
} from '@agentctl/ui';
import { RepoForkedIcon } from '@primer/octicons-react';

const modeIcon: Record<RewindMode, React.ComponentType<{ className?: string }>> = {
  conversation: RotateCcw,
  files: Undo2,
  fork: RepoForkedIcon,
};

const modeLabel: Record<RewindMode, string> = {
  conversation: 'Rewind conversation only',
  files: 'Rewind conversation & restore files',
  fork: 'Fork session from this checkpoint',
};

const actionVerb: Record<RewindMode, string> = {
  conversation: 'Rewind Conversation',
  files: 'Rewind & Restore Files',
  fork: 'Create Fork',
};

interface RewindConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sessionId?: string;
  eventId?: number;
  mode: RewindMode;
  messageCount: number;
  onConfirm: () => void;
  isLoading?: boolean;
  error?: string | null;
}

export function RewindConfirmDialog({
  open,
  onOpenChange,
  sessionId,
  eventId,
  mode,
  messageCount,
  onConfirm,
  isLoading,
  error,
}: RewindConfirmDialogProps) {
  const IconComponent = modeIcon[mode];

  const {
    data: snapshotData,
    isLoading: isLoadingSnapshot,
    isError: snapshotError,
  } = useQuery({
    queryKey: ['snapshot-preview', sessionId, eventId],
    queryFn: () => (sessionId && eventId ? previewSnapshotDiff(sessionId, eventId) : null),
    enabled: open && mode === 'files' && Boolean(sessionId && eventId),
  });

  const files = snapshotData?.files ?? [];
  const filesUnavailable = mode === 'files' && (!snapshotData?.hasSnapshot || snapshotError);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!isLoading) onOpenChange(next);
      }}
    >
      <DialogContent
        showCloseButton={!isLoading}
        aria-busy={isLoading || undefined}
        className="data-[state=open]:zoom-in-100 data-[state=closed]:zoom-out-100 data-[state=open]:slide-in-from-bottom-2 data-[state=closed]:slide-out-to-bottom-2 max-w-md overflow-hidden p-0"
      >
        <div className="p-5">
          <DialogHeader className="mb-4">
            <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-xl bg-white/5 ring-1 ring-white/10">
              <IconComponent className="text-accent h-4.5 w-4.5" />
            </div>
            <DialogTitle>{mode === 'fork' ? 'Fork session' : 'Rewind conversation'}</DialogTitle>
            <DialogDescription className="text-text-muted text-xs font-normal">
              {modeLabel[mode]}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="text-text-muted text-xs leading-relaxed font-normal">
              {mode === 'fork' ? (
                <p>
                  A new session will start with the first{' '}
                  <strong className="text-text-main font-semibold">{String(messageCount)}</strong>{' '}
                  messages. Your current workspace remains unchanged.
                </p>
              ) : mode === 'conversation' ? (
                <p>
                  Truncates the conversation timeline to this checkpoint. Messages after this point
                  ({String(messageCount)} messages) will be removed, but your workspace files remain
                  as they are.
                </p>
              ) : (
                <p>
                  Rolls back the conversation and restores the workspace checkpoint captured at this
                  turn.
                </p>
              )}
            </div>

            {mode === 'files' && (
              <div className="border-border/30 bg-surface/50 overflow-hidden rounded-xl border">
                <div className="border-border/20 bg-surface-secondary/40 flex items-center justify-between border-b px-3 py-2 text-[11px] font-medium">
                  <span className="text-text-main flex items-center gap-1.5 font-semibold">
                    <FileText className="h-3.5 w-3.5 opacity-60" />
                    <span>Files to be restored</span>
                  </span>
                  {isLoadingSnapshot ? (
                    <span className="text-text-muted flex items-center gap-1 text-[10px]">
                      <Spinner aria-hidden="true" className="icon-inline" />
                      Inspecting snapshot...
                    </span>
                  ) : (
                    <Badge variant="default" size="sm" className="font-mono text-[10px]">
                      {files.length} {files.length === 1 ? 'file' : 'files'}
                    </Badge>
                  )}
                </div>

                <div className="max-h-40 overflow-y-auto p-2">
                  {isLoadingSnapshot ? (
                    <div className="text-text-muted flex h-16 items-center justify-center gap-2 text-xs">
                      <Spinner aria-hidden="true" className="text-accent icon-default" />
                      <span>Reading file snapshot diff...</span>
                    </div>
                  ) : filesUnavailable ? (
                    <div className="text-text-muted flex h-16 items-center justify-center gap-2 text-xs">
                      <AlertCircle className="h-4 w-4" />
                      <span>
                        {snapshotError
                          ? 'Could not inspect this checkpoint. Try again.'
                          : 'File restoration is unavailable for this checkpoint.'}
                      </span>
                    </div>
                  ) : files.length > 0 ? (
                    <div className="space-y-1">
                      {files.map((f) => (
                        <div
                          key={f.path}
                          className="hover:bg-surface-secondary/40 flex items-center justify-between rounded-md px-2 py-1 font-mono text-xs transition-colors"
                        >
                          <span className="text-text-main truncate text-[11px]">{f.path}</span>
                          <span
                            className={`text-[10px] font-semibold uppercase ${
                              f.status === 'added'
                                ? 'text-emerald-400'
                                : f.status === 'deleted'
                                  ? 'text-rose-400'
                                  : 'text-amber-400'
                            }`}
                          >
                            {f.status}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-text-muted/60 flex h-16 flex-col items-center justify-center gap-1 text-xs">
                      <CheckCircle className="h-4 w-4 text-emerald-400/80" />
                      <span>No file changes detected since this snapshot.</span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {error && (
              <div className="border-danger/20 bg-danger/5 flex items-start gap-2 rounded-lg border p-2.5">
                <AlertCircle className="text-danger mt-0.5 h-4 w-4 shrink-0" />
                <div className="text-danger text-xs leading-snug">{error}</div>
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
            className="h-8 px-3 text-xs font-medium"
          >
            Cancel
          </Button>
          <Button
            onClick={onConfirm}
            disabled={isLoading || (mode === 'files' && (isLoadingSnapshot || filesUnavailable))}
            aria-busy={isLoading || undefined}
            className="min-w-36"
          >
            {isLoading ? (
              <>
                <Spinner aria-hidden="true" className="icon-compact" />
                <span>Rolling back...</span>
              </>
            ) : (
              <span>{actionVerb[mode]}</span>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
