import { Shield, Square, ArrowUp } from 'lucide-react';
import { Button, cn } from '@agentctl/ui';
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
  const show = canSend || isStop;

  if (!show) {
    return <ContextWindowPopover sessionData={sessionData} isLoading={isLoading} />;
  }

  return (
    <div className="flex items-center gap-1.5">
      <ContextWindowPopover sessionData={sessionData} isLoading={isLoading} />
      <Button
        size="sm"
        className={cn(
          'group/send flex h-8 w-8 items-center justify-center rounded-md border-none p-0 transition-colors duration-300',
          'visible translate-x-0 scale-100 opacity-100',
          isStop
            ? 'bg-rose-500 text-white shadow-[0_0_20px_rgba(244,63,94,0.25)] hover:bg-rose-600'
            : 'bg-accent text-brand-crust shadow-[0_0_20px_rgba(203,166,247,0.25)] hover:opacity-90',
        )}
        onClick={onSubmit}
        aria-label={isStop ? 'Stop session' : 'Execute command'}
      >
        {isStop ? (
          <Square className="h-4 w-4 fill-current" />
        ) : (
          <ArrowUp className="h-4 w-4 stroke-[3]" />
        )}
      </Button>
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
      <div className="text-text-muted/60 flex h-8 items-center gap-1.5 rounded-full border border-transparent px-3">
        <Shield className="h-3.5 w-3.5" />
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
      icon={
        <Shield
          className={cn('h-3.5 w-3.5', currentMode === 'yolo' ? 'text-danger' : 'text-text-muted')}
        />
      }
      options={[
        { value: 'review', label: 'Supervised' },
        { value: 'auto_approve', label: 'Auto Approve' },
        { value: 'yolo', label: 'Unsupervised' },
      ]}
    />
  );
}
