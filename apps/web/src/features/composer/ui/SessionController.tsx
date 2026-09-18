import { Square, ArrowUp } from 'lucide-react';
import { Button, cn, Tooltip } from '@agentctl/ui';
import { CommandDropdown } from './CommandDropdown';
import { ContextWindowPopover } from './WorkspaceStateReviewer';
import type { SessionWithCapabilities } from '@agentctl/shared';

export function SubmitButton({
  canSend,
  onSubmit,
  isStop,
  sessionData,
  isLoading,
}: {
  canSend: boolean;
  onSubmit: () => void;
  isStop?: boolean;
  sessionData: SessionWithCapabilities | null;
  isLoading: boolean;
}) {
  const show = canSend || Boolean(isStop);

  return (
    <div className="flex items-center gap-1.5">
      <ContextWindowPopover sessionData={sessionData} isLoading={isLoading} />
      {show && (
        <Tooltip content={isStop ? 'Stop agent (Esc twice)' : 'Execute command (Enter)'}>
          <Button
            size="sm"
            className={cn(
              'group/send animate-in fade-in zoom-in-95 flex h-8 w-8 items-center justify-center rounded-full border-none p-0 transition-all duration-200',
              isStop
                ? 'cursor-pointer bg-rose-500 text-white shadow-[0_0_20px_rgba(244,63,94,0.25)] hover:bg-rose-600'
                : 'bg-accent text-brand-crust cursor-pointer shadow-[0_0_20px_rgba(203,166,247,0.25)] hover:opacity-90 active:scale-95',
            )}
            onClick={onSubmit}
            aria-label={isStop ? 'Stop session' : 'Execute command'}
          >
            {isStop ? (
              <Square className="h-3.5 w-3.5 fill-current" />
            ) : (
              <ArrowUp className="h-4 w-4 stroke-[3]" />
            )}
          </Button>
        </Tooltip>
      )}
    </div>
  );
}

export function ApprovalModeSelector({
  isLoading,
  sessionData,
  isUpdating,
  setApprovalMode,
}: {
  isLoading: boolean;
  sessionData: SessionWithCapabilities | null;
  isUpdating: boolean;
  setApprovalMode: (mode: 'review' | 'auto_approve' | 'yolo') => Promise<void>;
}) {
  if (isLoading) {
    return (
      <div className="text-text-muted/60 flex h-8 items-center rounded-full border border-transparent px-2.5">
        <span className="text-xs font-medium">...</span>
      </div>
    );
  }

  if (!sessionData?.session) return null;

  const currentMode = sessionData.session.approvalMode;

  return (
    <CommandDropdown
      value={currentMode}
      disabled={isUpdating}
      variant="toolbar"
      onChange={(val) => {
        void setApprovalMode(val);
      }}
      options={[
        { value: 'review', label: 'Supervised' },
        { value: 'auto_approve', label: 'Auto Approve' },
        { value: 'yolo', label: 'Unsupervised' },
      ]}
    />
  );
}
