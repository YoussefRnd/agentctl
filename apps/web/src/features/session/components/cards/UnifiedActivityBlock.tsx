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
  Brain,
  Diff,
  Files,
  Copy,
} from 'lucide-react';
import { Spinner, StreamingDots } from '@/shared';
import { useSettings } from '@/hooks/useSettings';
import { useSession } from '@/contexts/SessionContext';
import { StreamingMarkdown } from './StreamingMarkdown';
import type { ACPEventRow, ACPEventToolCallData } from '@agentctl/shared';
import { isACPEventText, isACPEventToolCall } from '@agentctl/shared';

function formatDuration(durationMs?: number | null): string {
  if (!durationMs || durationMs <= 0) return '';
  if (durationMs < 1000) return `${String(Math.round(durationMs))}ms`;
  return `${(durationMs / 1000).toFixed(1)}s`;
}

function formatTokens(count: number): string {
  if (count >= 1000) return `${(count / 1000).toFixed(1)}k`;
  return String(count);
}

function formatShortPath(fullPath?: string): string {
  if (!fullPath) return '';
  const parts = fullPath.replace(/\\/g, '/').split('/');
  if (parts.length <= 3) return fullPath;
  return parts.slice(-3).join('/');
}

function getToolDisplayInfo(
  tool: string,
  payload: ACPEventToolCallData,
): { icon: string; label: string; sublabel?: string; color: string; isCommand: boolean } {
  const args = payload.arguments ?? {};
  const kind = payload.kind;
  const title = payload.title;
  const locations = payload.locations ?? [];

  // 1. Direct ACP v1 canonical kind mapping (official @agentclientprotocol/sdk specification)
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

function StepIcon({
  icon,
  color,
  className,
}: {
  icon: string;
  color?: string;
  className?: string;
}) {
  const cn = className ?? 'h-3.5 w-3.5';
  if (icon === 'terminal') return <Terminal className={`${cn} text-amber-400`} />;
  if (icon === 'file') return <FileText className={`${cn} text-emerald-400`} />;
  if (icon === 'edit') return <Edit3 className={`${cn} text-purple-400`} />;
  if (icon === 'search') return <Search className={`${cn} text-sky-400`} />;
  if (icon === 'trash') return <Trash2 className={`${cn} text-rose-400`} />;
  if (icon === 'think') return <Brain className={`${cn} text-accent`} />;
  return <Settings className={`${cn} ${color ?? 'text-text-muted'}`} />;
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

function DiffBlock({ block }: { block: Record<string, unknown> }) {
  const path = typeof block.path === 'string' ? block.path : 'file';
  const oldText = typeof block.oldText === 'string' ? block.oldText : null;
  const newText = typeof block.newText === 'string' ? block.newText : '';

  return (
    <div className="border-border/20 my-1 overflow-hidden rounded-md border bg-black/40">
      <div className="bg-surface-secondary/50 border-border/20 flex items-center gap-1.5 border-b px-2.5 py-1">
        <Diff className="text-accent h-3 w-3 shrink-0" />
        <span className="text-text-muted font-mono text-[10px] break-all">{path}</span>
      </div>
      <div className="no-scrollbar max-h-52 overflow-y-auto p-2.5 font-mono text-[10.5px] leading-relaxed">
        {oldText && (
          <div className="whitespace-pre-wrap text-rose-400/80">
            {oldText
              .split('\n')
              .map((line) => `- ${line}`)
              .join('\n')}
          </div>
        )}
        {newText && (
          <div className="whitespace-pre-wrap text-emerald-400/80">
            {newText
              .split('\n')
              .map((line) => `+ ${line}`)
              .join('\n')}
          </div>
        )}
      </div>
    </div>
  );
}

function LocationsView({ locations }: { locations: { path?: string; line?: number }[] }) {
  return (
    <div className="my-1 flex flex-wrap items-center gap-1.5">
      <Files className="text-text-muted/60 h-3 w-3 shrink-0" />
      {locations.map((loc, i) => (
        <code
          key={`${loc.path || ''}:${String(loc.line ?? i)}`}
          className="bg-surface-secondary/70 text-text-main border-border/25 rounded border px-1.5 py-0.5 font-mono text-[10px] break-all select-all"
        >
          {loc.path}
          {typeof loc.line === 'number' ? `:${String(loc.line)}` : ''}
        </code>
      ))}
    </div>
  );
}

function ToolOutputDetails({ call }: { call: ACPEventToolCallData }) {
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
        <DiffBlock key={i} block={b} />
      ))}

      {textBlocks.map((b, i) => {
        const inner = b.content as { text?: string } | undefined;
        const text = typeof inner?.text === 'string' ? inner.text : '';
        if (!text.trim()) return null;
        return (
          <div
            key={i}
            className="group/code border-border/25 text-text-main/90 no-scrollbar relative max-h-56 overflow-y-auto rounded-md border bg-black/40 p-2.5 font-mono text-[11px] leading-relaxed whitespace-pre-wrap select-text"
          >
            <button
              onClick={() => handleCopy(text)}
              className="bg-surface-secondary/70 hover:bg-surface-secondary border-border/20 text-text-muted hover:text-text-main absolute top-1.5 right-1.5 rounded border p-1 opacity-0 transition-opacity group-hover/code:opacity-100"
              title="Copy output"
            >
              {copied ? (
                <Check className="h-3 w-3 text-emerald-400" />
              ) : (
                <Copy className="h-3 w-3" />
              )}
            </button>
            {text}
          </div>
        );
      })}

      {fallbackText && (
        <div className="group/code border-border/25 text-text-main/90 no-scrollbar relative max-h-56 overflow-y-auto rounded-md border bg-black/40 p-2.5 font-mono text-[11px] leading-relaxed whitespace-pre-wrap select-text">
          <button
            onClick={() => handleCopy(fallbackText)}
            className="bg-surface-secondary/70 hover:bg-surface-secondary border-border/20 text-text-muted hover:text-text-main absolute top-1.5 right-1.5 rounded border p-1 opacity-0 transition-opacity group-hover/code:opacity-100"
            title="Copy output"
          >
            {copied ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
          </button>
          {fallbackText}
        </div>
      )}

      {locations.length > 0 && <LocationsView locations={locations} />}
    </div>
  );
}

const ToolStepRow = memo(function ToolStepRow({
  event,
  isStreaming,
}: {
  event: ACPEventRow;
  isStreaming?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(false);

  const reqData = event.data as {
    name?: string;
    request?: { toolCall?: { name?: string; arguments?: Record<string, unknown> } };
  };
  const toolName = reqData.request?.toolCall?.name ?? reqData.name ?? 'tool';
  const payload = (
    event.type === 'approval_request' ? (reqData.request?.toolCall ?? reqData) : event.data
  ) as ACPEventToolCallData;

  const status = payload.status;
  const isFailed = status === 'failed';
  const isPending = status === 'pending';
  const durationMs = event.metadata?.durationMs;

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
          {isStreaming || status === 'in_progress' ? (
            <StreamingDots className="ml-0" />
          ) : isFailed ? (
            <AlertCircle className="h-3 w-3 text-rose-500" />
          ) : isPending ? (
            <span className="bg-text-muted/40 h-1.5 w-1.5 rounded-full" />
          ) : (
            <Check className="h-3 w-3 stroke-[2.5] text-emerald-400/80" />
          )}

          {durationMs != null && durationMs > 0 && !isStreaming && (
            <span className="text-text-muted/40 font-mono tabular-nums">
              {formatDuration(durationMs)}
            </span>
          )}

          {hasDetails && (
            <ChevronRight
              className={`text-text-muted/30 h-3 w-3 transition-transform duration-150 ${
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

const ThoughtStepRow = memo(function ThoughtStepRow({
  event,
  isStreaming,
}: {
  event: ACPEventRow;
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
  events: ACPEventRow[];
  isStreaming?: boolean;
  isActive?: boolean;
  isInitialThinking?: boolean;
}

export function UnifiedActivityBlock({
  events,
  isStreaming = false,
  isActive = false,
  isInitialThinking = false,
}: UnifiedActivityBlockProps) {
  const { settings } = useSettings();
  const { sessionData } = useSession();
  const showThinking = settings?.showThinking ?? false;

  const sessionStatus = sessionData?.session.status;
  const isSessionActive = sessionStatus === 'running' || sessionStatus === 'needs_attention';
  const isCompleted = !isActive || !isSessionActive;

  const [userToggled, setUserToggled] = useState<boolean | null>(null);
  const isOpen = userToggled ?? (!isCompleted && showThinking);

  const { totalDurationMs, totalTokens, toolCount, thoughtCount } = useMemo(() => {
    let durMs = 0;
    let tokens = 0;
    let tools = 0;
    let thoughts = 0;

    for (const e of events) {
      if (e.metadata?.durationMs) durMs += e.metadata.durationMs;
      if (e.metadata?.completionTokens) tokens += e.metadata.completionTokens;
      if (isACPEventToolCall(e) || e.type === 'approval_request') tools++;
      if (isACPEventText(e) && e.data.role === 'thought') thoughts++;
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
    if (!isCompleted) {
      if (isInitialThinking) return 'Thinking...';
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
      parts.push(`${formatTokens(totalTokens)} tokens`);
    }

    return parts.join(' · ');
  }, [isCompleted, isInitialThinking, toolCount, thoughtCount, totalDurationMs, totalTokens]);

  const toggle = () => {
    if (events.length === 0 && !isInitialThinking) return;
    setUserToggled(!isOpen);
  };

  return (
    <div className="group/unified-activity w-full py-0.5">
      <button
        type="button"
        aria-expanded={isOpen}
        onClick={toggle}
        className="border-border/30 bg-surface-secondary/30 text-text-muted/80 hover:text-text-main hover:border-border/50 hover:bg-surface-secondary/40 focus-visible:ring-accent/40 flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1 text-[11.5px] font-medium tracking-wide transition-all outline-none select-none"
      >
        <Spinner done={isCompleted} />

        <span>{summaryLabel}</span>

        {!isCompleted && <StreamingDots className="ml-0.5" />}

        {(events.length > 0 || isInitialThinking) && (
          <ChevronRight
            className={`h-3 w-3 opacity-60 transition-transform duration-150 group-hover/unified-activity:opacity-100 ${
              isOpen ? 'rotate-90' : ''
            }`}
            aria-hidden={true}
          />
        )}
      </button>

      {isOpen && (
        <div className="animate-in fade-in slide-in-from-top-1 mt-2 mb-1 space-y-2 pl-1 duration-150">
          {events.map((e, idx) => {
            const isLast = idx === events.length - 1;
            const isStreamingThis = isStreaming && isLast;

            if (isACPEventText(e) && e.data.role === 'thought') {
              return <ThoughtStepRow key={e.id} event={e} isStreaming={isStreamingThis} />;
            }

            if (isACPEventToolCall(e) || e.type === 'approval_request') {
              return <ToolStepRow key={e.id} event={e} isStreaming={isStreamingThis} />;
            }

            return null;
          })}
        </div>
      )}
    </div>
  );
}
