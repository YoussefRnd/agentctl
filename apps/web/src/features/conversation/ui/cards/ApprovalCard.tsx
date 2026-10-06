import { useEffect, useRef, memo } from 'react';
import { ChevronDown, ShieldCheck } from 'lucide-react';
import type { SessionEventApprovalRequestData } from '@agentctl/shared';
import { GlassPanel } from '@agentctl/ui';

type ApprovalOption = {
  optionId: string;
  label: string;
  kind?: string;
  description?: string;
};

type ToolCall = {
  name: string;
  kind?: string;
  locations?: { path?: string }[];
  arguments?: Record<string, unknown>;
  rawInput?: unknown;
};

function isRejectOption(option: ApprovalOption): boolean {
  return (
    option.kind === 'reject_once' ||
    option.kind === 'reject_always' ||
    (!option.kind &&
      (/^(deny|reject|no)(?:\b|[_-])/i.test(option.optionId) ||
        /^(deny|reject|no)\b/i.test(option.label)))
  );
}

function isPersistentAllowOption(option: ApprovalOption): boolean {
  return (
    !isRejectOption(option) &&
    (option.kind === 'allow_always' ||
      (!option.kind && /(?:always|session|forever|permanent)/i.test(option.optionId)))
  );
}

function getToolTarget(toolCall: ToolCall | undefined): string | null {
  const args = toolCall?.arguments;
  const paths = toolCall?.locations?.flatMap((location) => (location.path ? [location.path] : []));
  if (paths?.length) return paths.join('\n');
  if (!args) return null;
  for (const key of ['url', 'uri', 'path', 'filePath', 'command', 'cmd']) {
    const value = args[key];
    if (typeof value === 'string' && value.trim()) return value;
  }
  return null;
}

export const ApprovalCard = memo(function ApprovalCard({
  eventId,
  data,
  onApprove,
  onDeny,
}: {
  eventId: number;
  data: SessionEventApprovalRequestData;
  onApprove: (eventId: number, optionId?: string) => void;
  onDeny: (eventId: number) => void;
}) {
  const approveButtonRef = useRef<HTMLButtonElement>(null);
  const denyButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    // Keep the safe response focused when the request appears.
    denyButtonRef.current?.focus();
  }, []);

  const request = data.request as
    | {
        description?: string;
        subagentId?: string;
        source?: 'client' | 'provider';
        subject?: { type?: string; [key: string]: unknown };
        toolCall?: ToolCall;
        options?: ApprovalOption[];
      }
    | undefined;
  const toolCall = request?.toolCall;
  const target = getToolTarget(toolCall);
  const options = request?.options ?? [];
  const hasRejectOption = options.some(isRejectOption);
  const orderedOptions = [
    ...options.filter(isRejectOption),
    ...options.filter((option) => !isRejectOption(option) && !isPersistentAllowOption(option)),
    ...options.filter(isPersistentAllowOption),
  ];
  const firstRejectId = orderedOptions.find(isRejectOption)?.optionId;
  const firstAllowId = orderedOptions.find((option) => !isRejectOption(option))?.optionId;
  const message = request?.description ?? data.message;
  const showMessage =
    !!message &&
    message !== 'This action requires your explicit approval before continuing.' &&
    (!target || !message.toLowerCase().includes(target.toLowerCase()));
  const details = {
    ...toolCall?.arguments,
    ...(toolCall?.kind ? { actionKind: toolCall.kind } : {}),
    ...(toolCall?.locations?.length ? { locations: toolCall.locations } : {}),
    ...(request?.subject && !['tool_call', 'command'].includes(request.subject.type ?? '')
      ? { subject: request.subject }
      : {}),
    ...(toolCall?.rawInput !== undefined &&
    (!toolCall.arguments ||
      typeof toolCall.rawInput !== 'object' ||
      Array.isArray(toolCall.rawInput))
      ? { input: toolCall.rawInput }
      : {}),
  };
  const hasArguments = Object.keys(details).length > 0;
  const actionClassName =
    'border-border/45 bg-surface-secondary/20 text-text-main hover:border-accent/40 hover:bg-accent/5 focus-visible:ring-accent/50 flex h-full min-h-10 w-full min-w-0 cursor-pointer items-center justify-center rounded-lg border px-2.5 py-1.5 text-center text-[13px] leading-snug font-medium [overflow-wrap:anywhere] transition-colors focus-visible:outline-none focus-visible:ring-2';

  return (
    <div
      role="region"
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
      className="animate-in fade-in zoom-in-95 mx-auto w-full max-w-[760px] min-w-0"
    >
      <GlassPanel
        intensity="high"
        className="border-border/40 flex w-full min-w-0 flex-col gap-0 overflow-hidden rounded-xl border shadow-lg"
      >
        <div className="flex min-w-0 items-start gap-2.5 px-3 py-2.5">
          <ShieldCheck className="text-accent mt-0.5 h-4 w-4 shrink-0" />
          <div className="min-w-0 flex-1">
            {request?.subagentId && (
              <p className="text-text-muted mb-1 text-xs">Subagent: {request.subagentId}</p>
            )}
            <div className="flex min-w-0 items-center gap-2">
              <span
                id="approval-title"
                className="text-text-main shrink-0 text-[13px] font-semibold"
              >
                {request?.source === 'client' ? 'Agentctl operation' : 'Permission request'}
              </span>
              {toolCall && (
                <span
                  className="text-text-muted truncate font-mono text-[11px]"
                  title={toolCall.name}
                >
                  {toolCall.name}
                </span>
              )}
            </div>
            {target ? (
              <p
                className="text-text-muted mt-0.5 line-clamp-2 min-w-0 font-mono text-xs leading-relaxed [overflow-wrap:anywhere]"
                title={target}
              >
                {target}
              </p>
            ) : (
              <p className="text-text-muted mt-0.5 text-xs leading-relaxed">
                {showMessage ? message : 'Agent requests approval to continue'}
              </p>
            )}
            {target && showMessage && (
              <p className="text-text-muted mt-0.5 text-xs leading-relaxed">{message}</p>
            )}
          </div>
        </div>

        {hasArguments && (
          <details open={!target} className="group min-w-0 px-3 pb-2">
            <summary className="text-text-muted hover:text-text-main flex w-fit cursor-pointer list-none items-center gap-1 text-[11px] transition-colors [&::-webkit-details-marker]:hidden">
              <ChevronDown className="h-3 w-3 -rotate-90 transition-transform group-open:rotate-0" />
              Details
            </summary>
            <pre className="border-border/25 bg-background/50 text-text-muted mt-2 max-h-40 min-w-0 overflow-auto rounded-md border p-2.5 font-mono text-[11px] leading-relaxed [overflow-wrap:anywhere] whitespace-pre-wrap">
              {JSON.stringify(details, null, 2)}
            </pre>
          </details>
        )}

        <div className="border-border/25 grid auto-rows-fr grid-cols-2 gap-1.5 border-t px-3 py-2.5">
          {!hasRejectOption && (
            <button
              ref={denyButtonRef}
              type="button"
              onClick={() => onDeny(eventId)}
              className={actionClassName}
            >
              Deny
            </button>
          )}
          {orderedOptions.map((option) => (
            <button
              key={option.optionId}
              ref={
                option.optionId === firstRejectId
                  ? denyButtonRef
                  : option.optionId === firstAllowId
                    ? approveButtonRef
                    : undefined
              }
              type="button"
              onClick={() => onApprove(eventId, option.optionId)}
              title={option.description ?? option.label}
              className={actionClassName}
            >
              {option.label}
            </button>
          ))}
          {options.length === 0 && (
            <button
              ref={approveButtonRef}
              type="button"
              onClick={() => onApprove(eventId)}
              className={actionClassName}
            >
              Approve once
            </button>
          )}
        </div>
      </GlassPanel>
    </div>
  );
});
