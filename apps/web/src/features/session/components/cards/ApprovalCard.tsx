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
  onApprove: (eventId: number, optionId?: string) => void;
  onDeny: (eventId: number) => void;
}) {
  const approveButtonRef = useRef<HTMLButtonElement>(null);
  const denyButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    approveButtonRef.current?.focus();
  }, []);

  const request = data.request as {
    toolCall?: {
      name: string;
      arguments?: Record<string, unknown>;
    };
    options?: {
      optionId: string;
      label: string;
      description?: string;
    }[];
  } | undefined;

  const toolCall = request?.toolCall;

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
      className="glass-card animate-in fade-in zoom-in-95 flex flex-col items-stretch justify-between gap-4 p-4 shadow-2xl duration-300 sm:flex-row sm:items-start"
    >
      <div className="flex flex-1 gap-3 min-w-0">
        <div className="bg-surface-secondary/50 border-border flex h-8 w-8 shrink-0 items-center justify-center rounded-sm border">
          <ShieldCheck className="text-accent h-4 w-4" />
        </div>
        <div className="flex-1 min-w-0">
          <div
            id="approval-title"
            className="text-text-main mb-0.5 text-[12px] font-black tracking-widest uppercase"
          >
            AUTHORIZATION_REQUESTED
          </div>
          <div className="text-text-muted text-[11px] font-bold tracking-tight uppercase opacity-60">
            {data.message ?? 'ACTION_REQUIRES_EXPLICIT_USER_CONSENT.'}
          </div>
          {toolCall && (
            <div className="mt-3 rounded-lg border border-white/5 bg-white/5 p-3 font-mono text-[11px] leading-relaxed">
              <div className="flex items-center gap-1.5 mb-1.5">
                <span className="text-accent-muted text-[10px] font-bold opacity-50 uppercase">TOOL:</span>
                <span className="text-accent font-black">{toolCall.name}</span>
              </div>
              {toolCall.arguments && Object.keys(toolCall.arguments).length > 0 && (
                <div className="text-text-muted/80 max-h-[150px] overflow-y-auto whitespace-pre-wrap rounded border border-white/5 bg-black/20 p-2">
                  {Object.entries(toolCall.arguments).map(([key, val]) => (
                    <div key={key} className="flex gap-2">
                      <span className="text-text-muted/40 font-bold shrink-0">{key}:</span>
                      <span className="text-text-main/90 break-all">
                        {typeof val === 'string'
                          ? val
                          : typeof val === 'number' || typeof val === 'boolean'
                            ? String(val)
                            : JSON.stringify(val, null, 2)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
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
        {request?.options && request.options.length > 0 ? (
          request.options.map((option, idx) => (
            <button
              key={option.optionId}
              ref={idx === 0 ? approveButtonRef : undefined}
              type="button"
              onClick={() => {
                onApprove(eventId, option.optionId);
              }}
              title={option.description}
              className="terminal-button !h-8 !px-4 text-[10px]"
            >
              {option.label.toUpperCase().replace(/\s+/g, '_')}
            </button>
          ))
        ) : (
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
        )}
      </div>
    </div>
  );
});
