import { useEffect, useRef, memo } from 'react';
import { ShieldCheck, X, Check } from 'lucide-react';
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
      role="dialog"
      aria-modal="true"
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
      className="p-5 bg-surface border border-accent/30 rounded-2xl shadow-immersive-lg flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-6 animate-in fade-in zoom-in-95 duration-300"
    >
      <div className="flex gap-4">
        <div className="shrink-0 w-10 h-10 bg-accent/10 rounded-xl flex items-center justify-center">
          <ShieldCheck className="w-5 h-5 text-accent" />
        </div>
        <div className="flex-1">
          <div
            id="approval-title"
            className="text-[14px] font-bold text-text-main mb-1 tracking-tight"
          >
            Permission Requested
          </div>
          <div className="text-[13px] text-text-muted leading-relaxed">
            {data.message ?? 'Gemini requires your authorization to execute this action.'}
          </div>
        </div>
      </div>
      <div className="flex gap-2 shrink-0">
        <button
          ref={denyButtonRef}
          type="button"
          onClick={() => {
            onDeny(eventId);
          }}
          className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-5 py-2.5 bg-surface-hover hover:bg-danger/10 text-text-muted hover:text-danger border border-border rounded-xl text-[13px] transition-all duration-200 font-semibold"
        >
          <X className="w-4 h-4" />
          Deny
        </button>
        <button
          ref={approveButtonRef}
          type="button"
          onClick={() => {
            onApprove(eventId);
          }}
          className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-6 py-2.5 bg-accent hover:bg-accent-hover text-background rounded-xl text-[13px] transition-all duration-200 font-bold shadow-[0_4px_12px_rgba(59,130,246,0.3)]"
        >
          <Check className="w-4 h-4" />
          Approve
        </button>
      </div>
    </div>
  );
});
