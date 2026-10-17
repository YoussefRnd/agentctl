import { useState, memo } from 'react';
import {
  Terminal,
  FileText,
  Edit3,
  Search,
  Trash2,
  BrainCircuit,
  Settings,
  Check,
  Copy,
  ChevronRight,
  AlertCircle,
} from 'lucide-react';
import type { SessionEventRow, SessionEventToolCallData } from '@agentctl/shared';
import {
  ToolDiffBlock as DiffBlock,
  ToolLocations as LocationsView,
  ToolOutput,
} from './ToolOutputContent';
import { StreamingDots } from '@/shared/ui/StreamingDots';
import { getCleanOutputText, getToolDisplayInfo, formatDuration } from '../lib/tool-presentation';

function StepIcon({ icon, className }: { icon: string; color?: string; className?: string }) {
  const cn = className ?? 'h-3.5 w-3.5';
  if (icon === 'terminal') return <Terminal className={`${cn} text-text-muted/60`} />;
  if (icon === 'file') return <FileText className={`${cn} text-text-muted/60`} />;
  if (icon === 'edit') return <Edit3 className={`${cn} text-text-muted/60`} />;
  if (icon === 'search') return <Search className={`${cn} text-text-muted/60`} />;
  if (icon === 'trash') return <Trash2 className={`${cn} text-rose-400/80`} />;
  if (icon === 'think') return <BrainCircuit className={`${cn} text-text-muted/60`} />;
  return <Settings className={`${cn} text-text-muted/60`} />;
}

function ToolOutputDetails({ call }: { call: SessionEventToolCallData }) {
  const contentBlocks = Array.isArray(call.content)
    ? (call.content as Record<string, unknown>[])
    : [];
  const locations = call.locations ?? [];
  const rawOutput = call.rawOutput;

  const diffBlocks = contentBlocks.filter((b) => b && typeof b === 'object' && b.type === 'diff');
  const textBlocks = contentBlocks.filter(
    (b) => b && typeof b === 'object' && b.type !== 'diff' && b.type !== 'terminal',
  );

  const fallbackText = textBlocks.length === 0 ? getCleanOutputText(rawOutput) : null;
  const [copied, setCopied] = useState(false);

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="space-y-1 pt-1 pb-1">
      {diffBlocks.map((b, i) => (
        <DiffBlock compact key={i} block={b} />
      ))}

      {textBlocks.map((b, i) => {
        const inner = b.content as { text?: string } | undefined;
        const text = typeof inner?.text === 'string' ? inner.text : '';
        if (!text.trim()) return null;
        return (
          <ToolOutput
            key={i}
            className="max-h-56"
            action={
              <button
                type="button"
                onClick={() => handleCopy(text)}
                className="bg-surface-secondary/70 hover:bg-surface-secondary border-border/20 text-text-muted hover:text-text-main focus-visible:ring-accent/40 rounded-md border p-1 opacity-0 transition-opacity group-focus-within/output:opacity-100 group-hover/output:opacity-100 focus-visible:ring-2 focus-visible:outline-none"
                title="Copy output"
              >
                {copied ? (
                  <Check className="h-3 w-3 text-emerald-400" />
                ) : (
                  <Copy className="h-3 w-3" />
                )}
              </button>
            }
          >
            {text}
          </ToolOutput>
        );
      })}

      {fallbackText && (
        <ToolOutput
          className="max-h-56"
          action={
            <button
              type="button"
              onClick={() => handleCopy(fallbackText)}
              className="bg-surface-secondary/70 hover:bg-surface-secondary border-border/20 text-text-muted hover:text-text-main focus-visible:ring-accent/40 rounded-md border p-1 opacity-0 transition-opacity group-focus-within/output:opacity-100 group-hover/output:opacity-100 focus-visible:ring-2 focus-visible:outline-none"
              title="Copy output"
            >
              {copied ? (
                <Check className="h-3 w-3 text-emerald-400" />
              ) : (
                <Copy className="h-3 w-3" />
              )}
            </button>
          }
        >
          {fallbackText}
        </ToolOutput>
      )}

      {locations.length > 0 && <LocationsView className="my-1" locations={locations} />}
    </div>
  );
}

export const ToolStepRow = memo(function ToolStepRow({
  event,
  isStreaming,
  isCompleted,
}: {
  event: SessionEventRow;
  isStreaming?: boolean;
  isCompleted?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(false);

  const reqData = event.data as {
    name?: string;
    request?: { toolCall?: { name?: string; arguments?: Record<string, unknown> } };
  };
  const toolName = reqData.request?.toolCall?.name ?? reqData.name ?? 'tool';
  const payload = (
    event.type === 'approval_request' ? (reqData.request?.toolCall ?? reqData) : event.data
  ) as SessionEventToolCallData;

  const status = payload.status;
  const isFailed = status === 'failed';
  const isPending = status === 'pending';
  const unresolved = status === 'unknown' || status === 'interrupted' || status === 'cancelled';
  const durationMs = event.metadata?.durationMs;
  const hasFinishedDuration = durationMs != null && durationMs > 0;
  const isStillInProgress =
    !unresolved &&
    !isCompleted &&
    !hasFinishedDuration &&
    (isStreaming || status === 'in_progress');

  const info = getToolDisplayInfo(toolName, payload);
  const cleanOutput = getCleanOutputText(payload.rawOutput);
  const hasDetails =
    (Array.isArray(payload.content) && payload.content.length > 0) ||
    (payload.locations && payload.locations.length > 0) ||
    (cleanOutput !== null && cleanOutput.length > 0);

  return (
    <div className="group/step py-0.5">
      <div
        onClick={() => hasDetails && setIsOpen(!isOpen)}
        className={`flex items-center gap-2 rounded px-1.5 py-1 text-[11.5px] transition-colors ${
          hasDetails ? 'cursor-pointer hover:bg-white/[0.04]' : 'cursor-default'
        } ${isFailed ? 'text-rose-400' : 'text-text-muted/80 hover:text-text-main'}`}
      >
        <div className="flex shrink-0 items-center justify-center opacity-85">
          <StepIcon icon={info.icon} color={info.color} className="h-3.5 w-3.5" />
        </div>

        <span
          className={`min-w-0 flex-1 truncate ${
            info.isCommand
              ? 'text-text-main/90 font-mono text-[11px]'
              : 'text-text-main/80 font-medium'
          }`}
          title={info.sublabel ?? info.label}
        >
          {info.label}
        </span>

        <div className="ml-auto flex shrink-0 items-center gap-2 pl-2 text-[10px]">
          {unresolved ? (
            <span>
              {status === 'unknown'
                ? 'Status unknown'
                : status === 'cancelled'
                  ? 'Cancelled'
                  : 'Interrupted'}
            </span>
          ) : isStillInProgress ? (
            <StreamingDots className="ml-0" />
          ) : isFailed ? (
            <AlertCircle className="h-3.5 w-3.5 text-rose-500" />
          ) : isPending ? (
            <span className="bg-text-muted/40 h-1.5 w-1.5 rounded-full" />
          ) : (
            <Check className="h-3.5 w-3.5 stroke-[2.5] text-emerald-400/80" />
          )}

          {durationMs != null && durationMs > 0 && !isStreaming && (
            <span className="text-text-muted/40 font-mono tabular-nums">
              {formatDuration(durationMs)}
            </span>
          )}

          {hasDetails && (
            <ChevronRight
              className={`text-text-muted/30 h-3.5 w-3.5 transition-transform duration-150 ${
                isOpen ? 'text-text-muted rotate-90' : ''
              }`}
            />
          )}
        </div>
      </div>

      {isOpen && hasDetails && (
        <div className="pr-1 pl-5">
          <ToolOutputDetails call={payload} />
        </div>
      )}
    </div>
  );
});
