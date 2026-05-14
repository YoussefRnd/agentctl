import { useEffect, useRef } from 'react';

export function ApprovalCard({ 
  eventId, 
  data, 
  onApprove, 
  onDeny 
}: { 
  eventId: number; 
  data: { message?: string } | null; 
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
      className="p-4 bg-surface border-t-2 border-accent shadow-lg flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4 my-4 animate-in fade-in slide-in-from-bottom-4"
    >
      <div className="flex-1">
        <div id="approval-title" className="text-sm font-bold text-accent mb-1">Approval Requested</div>
        <div className="text-xs text-text-muted">
          {data?.message ?? 'Agent needs permission to proceed.'}
        </div>
      </div>
      <div className="flex gap-2 self-stretch sm:self-auto">
        <button 
          ref={denyButtonRef}
          type="button"
          onClick={() => { onDeny(eventId); }}
          className="px-4 py-2 bg-red-500/20 hover:bg-red-500/30 text-red-400 rounded text-sm transition-colors font-medium"
        >
          Deny
        </button>
        <button 
          ref={approveButtonRef}
          type="button"
          onClick={() => { onApprove(eventId); }}
          className="px-4 py-2 bg-accent hover:bg-accent-hover text-background rounded text-sm transition-colors font-medium"
        >
          Approve
        </button>
      </div>
    </div>
  );
}
