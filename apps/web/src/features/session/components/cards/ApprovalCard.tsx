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
      className="bg-surface border-accent/30 shadow-immersive-lg animate-in fade-in zoom-in-95 flex flex-col items-stretch justify-between gap-6 rounded-2xl border p-5 duration-300 sm:flex-row sm:items-center"
    >
      <div className="flex gap-4">
        <div className="bg-accent/10 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl">
          <ShieldCheck className="text-accent h-5 w-5" />
        </div>
        <div className="flex-1">
          <div
            id="approval-title"
            className="text-text-main mb-1 text-[14px] font-bold tracking-tight"
          >
            Permission Requested
          </div>
          <div className="text-text-muted text-[13px] leading-relaxed">
            {data.message ?? 'Gemini requires your authorization to execute this action.'}
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
          className="bg-surface-hover hover:bg-danger/10 text-text-muted hover:text-danger border-border flex flex-1 items-center justify-center gap-2 rounded-xl border px-5 py-2.5 text-[13px] font-semibold transition-all duration-200 sm:flex-none"
        >
          <X className="h-4 w-4" />
          Deny
        </button>
        <button
          ref={approveButtonRef}
          type="button"
          onClick={() => {
            onApprove(eventId);
          }}
          className="bg-accent hover:bg-accent-hover text-background flex flex-1 items-center justify-center gap-2 rounded-xl px-6 py-2.5 text-[13px] font-bold shadow-[0_4px_12px_rgba(59,130,246,0.3)] transition-all duration-200 sm:flex-none"
        >
          <Check className="h-4 w-4" />
          Approve
        </button>
      </div>
    </div>
  );
});
