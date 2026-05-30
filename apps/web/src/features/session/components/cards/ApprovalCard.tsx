import { useEffect, useRef, memo } from 'react';
import { ShieldCheck } from 'lucide-react';
import type { ACPEventApprovalRequestData } from '@agentctl/shared';

export const ApprovalCard = memo(function ApprovalCard({
  eventId,
  data,
  onApprove,
  onDeny,
}: {
  eventId: number;
  data: ACPEventApprovalRequestData;
  onApprove: (eventId: number) => void;
  onDeny: (eventId: number) => void;
}) {
  const approveButtonRef = useRef<HTMLButtonElement>(null);
  const denyButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    approveButtonRef.current?.focus();
  }, []);

  return (
    <div
      role="region"
      aria-labelledby="approval-title"
      aria-live="polite"
      tabIndex={-1}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          onDeny(eventId);
        }
        if (e.key === 'ArrowLeft') {
          e.preventDefault();
          denyButtonRef.current?.focus();
        }
        if (e.key === 'ArrowRight') {
          e.preventDefault();
          approveButtonRef.current?.focus();
        }
      }}
      className="glass-card animate-in fade-in zoom-in-95 flex flex-col items-stretch justify-between gap-3 p-3 shadow-2xl duration-300 sm:flex-row sm:items-center"
    >
      <div className="flex gap-3">
        <div className="bg-surface-secondary/50 border-border flex h-8 w-8 shrink-0 items-center justify-center rounded-sm border">
          <ShieldCheck className="text-accent h-4 w-4" />
        </div>
        <div className="flex-1">
          <div
            id="approval-title"
            className="text-text-main mb-0.5 text-[12px] font-black tracking-widest uppercase"
          >
            AUTHORIZATION_REQUESTED
          </div>
          <div className="text-text-muted text-[11px] font-bold tracking-tight uppercase opacity-60">
            {data.message ?? 'ACTION_REQUIRES_EXPLICIT_USER_CONSENT.'}
          </div>
        </div>
      </div>
      <div className="flex shrink-0 gap-2">
        <button
          ref={denyButtonRef}
          type="button"
          onClick={() => {
            onDeny(eventId);
          }}
          className="text-text-muted hover:text-danger px-3 py-1 text-[10px] font-black uppercase transition-colors"
        >
          DENY
        </button>
        <button
          ref={approveButtonRef}
          type="button"
          onClick={() => {
            onApprove(eventId);
          }}
          className="terminal-button !h-8 !px-4 text-[10px]"
        >
          APPROVE_ACTION
        </button>
      </div>
    </div>
  );
});
