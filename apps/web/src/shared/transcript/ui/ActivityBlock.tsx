import { useState, useMemo, memo } from 'react';
import { ChevronRight, AlertCircle } from 'lucide-react';
import { ThinkingSpinner } from '@/shared/ui/Spinner';
import { formatTokenCount } from '@/shared/lib/formatTokenCount';
import { StreamingMarkdown } from '@/shared/markdown/ui/StreamingMarkdown';
import { isSessionEventText, isSessionEventToolCall, type SessionEventRow } from '@agentctl/shared';
import { ToolStepRow } from './ToolActivityRow';

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

export interface ActivityBlockProps {
  events: SessionEventRow[];
  isStreaming?: boolean;
  isCompleted: boolean;
  showThinking: boolean;
  isWaitingForResponse?: boolean;
  providerError?: string;
}

export function ActivityBlock({
  events,
  isStreaming = false,
  isCompleted,
  showThinking,
  isWaitingForResponse = false,
  providerError,
}: ActivityBlockProps) {
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
