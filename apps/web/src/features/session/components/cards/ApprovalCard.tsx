import { useEffect, useRef, memo } from 'react';
import { ShieldCheck } from 'lucide-react';
import type { ACPEventApprovalRequestData } from '@agentctl/shared';
import { GlassPanel } from '@agentctl/ui';

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
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Focus Deny button on mount so hitting Enter/Space accidentally
    // safely denies the action rather than auto-approving.
    denyButtonRef.current?.focus();
  }, []);

  const request = data.request as
    | {
        toolCall?: {
          name: string;
          arguments?: Record<string, unknown>;
        };
        options?: {
          optionId: string;
          label: string;
          description?: string;
        }[];
      }
    | undefined;

  const toolCall = request?.toolCall;

  const btnBase =
    'inline-flex items-center justify-center rounded-xl font-sans font-bold tracking-tight transition-all focus:outline-none focus:ring-2 focus:ring-accent/40 disabled:opacity-30 disabled:pointer-events-none cursor-pointer';
  const btnSolid = 'bg-accent text-brand-crust hover:opacity-90 active:scale-[0.98]';
  const btnGhost = 'bg-transparent hover:bg-white/5 text-text-muted hover:text-text-main';

  return (
    <div
      ref={containerRef}
      role="presentation"
      aria-labelledby="approval-title"
      aria-live="polite"
      tabIndex={-1}
      onKeyDown={(e: React.KeyboardEvent<HTMLDivElement>) => {
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
      className="animate-in fade-in zoom-in-95 duration-300"
    >
      <GlassPanel
        intensity="high"
        className="border-border/40 flex flex-col items-stretch justify-between gap-4 rounded-2xl border p-5 shadow-2xl sm:flex-row sm:items-start"
      >
        <div className="flex min-w-0 flex-1 gap-3.5">
          <div className="bg-surface-secondary/50 border-border/60 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border">
            <ShieldCheck className="text-accent h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div
              id="approval-title"
              className="text-text-main mb-0.5 text-[12px] font-bold tracking-wide uppercase"
            >
              Approval required
            </div>
            <div className="text-text-muted text-[11px] leading-relaxed opacity-85">
              {data.message ?? 'This action requires your explicit approval before continuing.'}
            </div>
            {toolCall && (
              <div className="border-border/30 bg-surface-secondary/40 mt-3 rounded-xl border p-3.5 font-mono text-[11px] leading-relaxed">
                <div className="mb-1.5 flex items-center gap-1.5">
                  <span className="text-text-muted/40 text-[9px] font-bold tracking-wider uppercase">
                    Tool:
                  </span>
                  <span className="text-accent font-semibold">{toolCall.name}</span>
                </div>
                {toolCall.arguments && Object.keys(toolCall.arguments).length > 0 && (
                  <div className="text-text-muted/80 border-border/20 bg-background/50 max-h-[150px] overflow-y-auto rounded-lg border p-2.5 whitespace-pre-wrap">
                    {Object.entries(toolCall.arguments).map(([key, val]) => (
                      <div key={key} className="flex gap-2">
                        <span className="text-text-muted/40 shrink-0 font-medium">{key}:</span>
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
            className={`${btnBase} ${btnGhost} text-text-muted hover:text-danger h-8 px-4 text-[10px] font-bold tracking-widest uppercase focus:ring-rose-500/50`}
          >
            Deny
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
                className={`${btnBase} ${btnSolid} h-8 px-4 text-[10px] font-bold tracking-widest uppercase`}
              >
                {option.label}
              </button>
            ))
          ) : (
            <button
              ref={approveButtonRef}
              type="button"
              onClick={() => {
                onApprove(eventId);
              }}
              className={`${btnBase} ${btnSolid} h-8 px-4 text-[10px] font-bold tracking-widest uppercase`}
            >
              Approve
            </button>
          )}
        </div>
      </GlassPanel>
    </div>
  );
});
