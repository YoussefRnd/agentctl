import {
  ToolDiffBlock as DiffBlock,
  ToolLocations as LocationsView,
  ToolOutput,
} from './ToolOutputContent';
import { useState, useMemo, memo } from 'react';
import {
  ChevronRight,
  Terminal,
  FileText,
  Search,
  Settings,
  AlertCircle,
  Check,
  Edit3,
  Trash2,
  BrainCircuit,
  Copy,
} from 'lucide-react';
import { ThinkingSpinner, StreamingDots } from '@/shared';
import { useSettings } from '@/features/settings';
import { useSession, useSessionTurnState } from '@/features/sessions';
import { formatTokenCount } from '@/shared/lib/formatTokenCount';
import { StreamingMarkdown } from './StreamingMarkdown';
import type { SessionEventRow, SessionEventToolCallData } from '@agentctl/shared';
import { isSessionEventText, isSessionEventToolCall } from '@agentctl/shared';

function formatDuration(durationMs?: number | null): string {
  if (!durationMs || durationMs <= 0) return '';
  if (durationMs < 1000) return `${String(Math.round(durationMs))}ms`;
  return `${(durationMs / 1000).toFixed(1)}s`;
}

function formatShortPath(fullPath?: string): string {
  if (!fullPath) return '';
  const parts = fullPath.replace(/\\/g, '/').split('/');
  if (parts.length <= 3) return fullPath;
  return parts.slice(-3).join('/');
}

export function getToolDisplayInfo(
  tool: string,
  payload: SessionEventToolCallData,
): { icon: string; label: string; sublabel?: string; color: string; isCommand: boolean } {
  const args = payload.arguments ?? {};
  const kind = payload.kind;
  const title = payload.title;
  const locations = payload.locations ?? [];

  // 1. Canonical product tool-kind mapping
  if (kind === 'execute') {
    const rawCmd = args.CommandLine ?? args.command ?? args.cmd ?? args.input;
    const cmdText = (typeof rawCmd === 'string' && rawCmd) || title || tool;
    return {
      icon: 'terminal',
      label: cmdText,
      color: 'text-amber-400',
      isCommand: true,
    };
  }

  if (kind === 'edit') {
    const rawPath =
      (typeof args.TargetFile === 'string' && args.TargetFile) ||
      (typeof args.AbsolutePath === 'string' && args.AbsolutePath) ||
      (typeof args.path === 'string' && args.path) ||
      (typeof args.filePath === 'string' && args.filePath) ||
      (typeof args.file === 'string' && args.file) ||
      locations[0]?.path;
    return {
      icon: 'edit',
      label: rawPath ? `Edited ${formatShortPath(rawPath)}` : (title ?? 'Edited file'),
      sublabel: rawPath,
      color: 'text-purple-400',
      isCommand: false,
    };
  }

  if (kind === 'read') {
    const rawPath =
      (typeof args.AbsolutePath === 'string' && args.AbsolutePath) ||
      (typeof args.path === 'string' && args.path) ||
      (typeof args.filePath === 'string' && args.filePath) ||
      (typeof args.file === 'string' && args.file) ||
      locations[0]?.path;
    return {
      icon: 'file',
      label: rawPath ? `Read ${formatShortPath(rawPath)}` : (title ?? 'Read file'),
      sublabel: rawPath,
      color: 'text-emerald-400',
      isCommand: false,
    };
  }

  if (kind === 'search' || kind === 'fetch') {
    const rawQuery =
      (typeof args.Query === 'string' && args.Query) ||
      (typeof args.query === 'string' && args.query) ||
      (typeof args.Pattern === 'string' && args.Pattern) ||
      (typeof args.pattern === 'string' && args.pattern);
    const q = rawQuery ? `"${rawQuery}"` : '';
    return {
      icon: 'search',
      label: q ? `Searched ${q}` : (title ?? 'Search'),
      color: 'text-sky-400',
      isCommand: false,
    };
  }

  if (kind === 'move') {
    const rawPath =
      (typeof args.path === 'string' && args.path) ||
      (typeof args.AbsolutePath === 'string' && args.AbsolutePath) ||
      (typeof args.TargetFile === 'string' && args.TargetFile) ||
      locations[0]?.path;
    return {
      icon: 'file',
      label: rawPath ? `Moved ${formatShortPath(rawPath)}` : (title ?? 'Moved file'),
      sublabel: rawPath,
      color: 'text-brand-green',
      isCommand: false,
    };
  }

  if (kind === 'delete') {
    const rawPath =
      (typeof args.path === 'string' && args.path) ||
      (typeof args.AbsolutePath === 'string' && args.AbsolutePath) ||
      (typeof args.TargetFile === 'string' && args.TargetFile) ||
      locations[0]?.path;
    return {
      icon: 'trash',
      label: rawPath ? `Deleted ${formatShortPath(rawPath)}` : (title ?? 'Deleted file'),
      sublabel: rawPath,
      color: 'text-rose-400',
      isCommand: false,
    };
  }

  // 2. If provider provided a human-readable title directly:
  if (title && title.trim() && title.toLowerCase() !== 'tool') {
    const isCommand =
      typeof args.CommandLine === 'string' ||
      typeof args.command === 'string' ||
      title.startsWith('Run ') ||
      title.startsWith('Execute ');
    return {
      icon: isCommand ? 'terminal' : 'settings',
      label: title,
      color: isCommand ? 'text-amber-400' : 'text-text-muted',
      isCommand,
    };
  }

  // 3. Fallback to typed argument structure or tool name:
  const rawCmd = args.CommandLine ?? args.command ?? args.cmd;
  if (typeof rawCmd === 'string') {
    return {
      icon: 'terminal',
      label: rawCmd,
      color: 'text-amber-400',
      isCommand: true,
    };
  }

  const cleanName = (tool.startsWith('call_') ? tool.substring(5) : tool)
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());

  return {
    icon: 'settings',
    label: cleanName || 'Tool Call',
    color: 'text-text-muted',
    isCommand: false,
  };
}

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

function getCleanOutputText(rawOutput: unknown): string | null {
  if (rawOutput === null || rawOutput === undefined) return null;
  if (typeof rawOutput === 'string') return rawOutput.trim() || null;
  if (typeof rawOutput === 'object') {
    const rec = rawOutput as Record<string, unknown>;
    if (typeof rec.output === 'string') return rec.output.trim() || null;
    if (typeof rec.stdout === 'string') return rec.stdout.trim() || null;
    if (typeof rec.result === 'string') return rec.result.trim() || null;
    if (typeof rec.text === 'string') return rec.text.trim() || null;
    if (typeof rec.content === 'string') return rec.content.trim() || null;
    if (typeof rec.message === 'string') return rec.message.trim() || null;
    const str = JSON.stringify(rawOutput, null, 2);
    return str === '{}' ? null : str;
  }
  return String(rawOutput);
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

export const ThoughtStepRow = memo(function ThoughtStepRow({
  event,
  isStreaming,
}: {
  event: SessionEventRow;
  isStreaming?: boolean;
}) {
  const content = (event.data as { content?: string })?.content ?? '';
  if (!content.trim()) return null;

  return (
    <div className="text-text-muted/80 prose prose-invert prose-p:my-1 prose-headings:my-1.5 prose-headings:font-medium prose-headings:text-text-main/90 prose-headings:text-[12.5px] prose-ul:my-1 prose-li:my-0.5 prose-code:bg-white/[0.06] prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:text-[11px] prose-code:font-mono max-w-none py-1 font-sans text-[12px] leading-relaxed select-text">
      <StreamingMarkdown content={content} isStreaming={isStreaming} />
    </div>
  );
});

interface UnifiedActivityBlockProps {
  events: SessionEventRow[];
  isStreaming?: boolean;
  isActive?: boolean;
  isWaitingForResponse?: boolean;
  providerError?: string;
  isResponding?: boolean;
}

export function UnifiedActivityBlock({
  events,
  isStreaming = false,
  isActive = false,
  isWaitingForResponse = false,
  providerError,
  isResponding = false,
}: UnifiedActivityBlockProps) {
  const { settings } = useSettings();
  const { sessionData } = useSession();
  const turn = useSessionTurnState();
  const showThinking = settings?.showThinking ?? false;

  const sessionStatus = sessionData?.session.status;
  const isSessionActive =
    sessionStatus === 'running' || sessionStatus === 'needs_attention' || turn !== null;
  const isCompleted = isResponding || !isActive || !isSessionActive;

  const [userToggled, setUserToggled] = useState<boolean | null>(null);
  const isOpen = events.length > 0 && (userToggled ?? (!isCompleted && showThinking));

  const { totalDurationMs, totalTokens, toolCount, thoughtCount } = useMemo(() => {
    let durMs = 0;
    let tokens = 0;
    let tools = 0;
    let thoughts = 0;

    for (const e of events) {
      if (e.metadata?.durationMs) durMs += e.metadata.durationMs;
      if (e.metadata?.completionTokens) tokens += e.metadata.completionTokens;
      if (isSessionEventToolCall(e) || e.type === 'approval_request') tools++;
      if (isSessionEventText(e) && e.data.role === 'thought') thoughts++;
    }

    if (durMs === 0 && events.length > 0) {
      const start = events[0].createdAt;
      const end = events[events.length - 1].createdAt;
      durMs = Math.max(0, new Date(end).getTime() - new Date(start).getTime());
    }

    return {
      totalDurationMs: durMs,
      totalTokens: tokens,
      toolCount: tools,
      thoughtCount: thoughts,
    };
  }, [events]);

  const summaryLabel = useMemo(() => {
    if (providerError) return 'Provider error';
    if (isWaitingForResponse) return 'Waiting for response';
    if (!isCompleted) {
      if (toolCount > 0 && thoughtCount > 0)
        return `Thinking & running ${toolCount} tool${toolCount > 1 ? 's' : ''}`;
      if (toolCount > 0) return `Running ${toolCount} tool${toolCount > 1 ? 's' : ''}`;
      return 'Thinking...';
    }

    const dur =
      totalDurationMs > 1000
        ? `${(totalDurationMs / 1000).toFixed(1)}s`
        : totalDurationMs > 0
          ? `${String(Math.round(totalDurationMs))}ms`
          : '';

    const parts: string[] = [];
    if (thoughtCount > 0 && dur) {
      parts.push(`Thought for ${dur}`);
    } else if (dur) {
      parts.push(`Ran for ${dur}`);
    } else {
      parts.push('Completed activity');
    }

    if (toolCount > 0) {
      parts.push(`${toolCount} action${toolCount > 1 ? 's' : ''}`);
    }
    if (totalTokens > 0) {
      parts.push(`${formatTokenCount(totalTokens)} tokens`);
    }

    return parts.join(' · ');
  }, [
    providerError,
    isCompleted,
    isWaitingForResponse,
    toolCount,
    thoughtCount,
    totalDurationMs,
    totalTokens,
  ]);

  const toggle = () => {
    if (events.length === 0) return;
    setUserToggled(!isOpen);
  };

  if (events.length === 0 && !isWaitingForResponse && !providerError) return null;
  const Header = events.length > 0 ? 'button' : 'div';

  return (
    <div className="w-full py-0.5">
      <Header
        type={events.length > 0 ? 'button' : undefined}
        aria-expanded={events.length > 0 ? isOpen : undefined}
        role={providerError ? 'alert' : isWaitingForResponse ? 'status' : undefined}
        onClick={events.length > 0 ? toggle : undefined}
        className={`text-text-muted/80 hover:text-text-main group/activity-btn inline-flex max-w-full items-center gap-2 text-[15px] font-normal tracking-tight transition-colors outline-none select-none ${
          events.length > 0 ? 'cursor-pointer' : 'cursor-default'
        }`}
      >
        {providerError ? (
          <AlertCircle aria-hidden="true" className="text-danger h-4 w-4 shrink-0" />
        ) : (
          <ThinkingSpinner done={isCompleted} className="text-accent text-[15px]" />
        )}
        <span
          className={`min-w-0 text-left [overflow-wrap:anywhere] ${providerError ? 'text-danger' : ''}`}
        >
          {summaryLabel}
          {providerError && (
            <span className="text-text-muted mt-1 block text-left text-xs">{providerError}</span>
          )}
        </span>
        {events.length > 0 && (
          <ChevronRight
            className={`h-3.5 w-3.5 opacity-60 transition-transform duration-150 group-hover/activity-btn:opacity-100 ${
              isOpen ? 'rotate-90' : ''
            }`}
            aria-hidden={true}
          />
        )}
      </Header>

      {isOpen && (
        <div className="animate-in fade-in slide-in-from-top-1 mt-2 mb-1 space-y-2 pl-1 duration-150">
          {events.map((e, idx) => {
            const isLast = idx === events.length - 1;
            const isStreamingThis = isStreaming && isLast;

            if (isSessionEventText(e) && e.data.role === 'thought') {
              return <ThoughtStepRow key={e.id} event={e} isStreaming={isStreamingThis} />;
            }

            if (isSessionEventToolCall(e) || e.type === 'approval_request') {
              return (
                <ToolStepRow
                  key={e.id}
                  event={e}
                  isStreaming={isStreamingThis}
                  isCompleted={isCompleted}
                />
              );
            }

            return null;
          })}
        </div>
      )}
    </div>
  );
}
