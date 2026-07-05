import { useState, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import { ChevronRight } from 'lucide-react';
import { Spinner } from '@/components/ui/Spinner';
import { useSettings } from '@/hooks/useSettings';
import { useSession } from '@/contexts/SessionContext';
import { ToolCallCard } from './ToolCallCard';
import { TimelineEvent } from './TimelineEvent';
import type { ACPEventRow, ACPEventToolCallData } from '@agentctl/shared';

interface ThinkingBlockProps {
  events: ACPEventRow[];
  isStreaming?: boolean;
  isActive?: boolean;
}

function dotColorForTool(name: string, kind?: string): string {
  if (kind) {
    if (kind === 'read' || kind === 'edit' || kind === 'move') return 'bg-brand-green';
    if (kind === 'delete') return 'bg-rose-500';
    if (kind === 'search' || kind === 'fetch') return 'bg-brand-blue';
    if (kind === 'execute') return 'bg-brand-peach';
    if (kind === 'think') return 'bg-accent';
  }
  if (
    name.includes('file') ||
    name.includes('view') ||
    name.includes('read') ||
    name.includes('write')
  )
    return 'bg-brand-green';
  if (name.includes('search') || name.includes('grep')) return 'bg-brand-blue';
  if (name.includes('command') || name.includes('shell') || name.includes('run'))
    return 'bg-brand-peach';
  return 'bg-text-muted/40';
}

export function ThinkingBlock({
  events,
  isStreaming = false,
  isActive = false,
}: ThinkingBlockProps) {
  const { settings } = useSettings();
  const { sessionData } = useSession();
  const showThinking = settings?.showThinking ?? false;

  const sessionStatus = sessionData?.session.status;
  const isSessionActive = sessionStatus === 'running' || sessionStatus === 'needs_attention';
  const isCompleted = !isActive || !isSessionActive;

  const [isOpen, setIsOpen] = useState(() => !isCompleted && showThinking);
  const [prevIsCompleted, setPrevIsCompleted] = useState(isCompleted);
  const [prevShowThinking, setPrevShowThinking] = useState(showThinking);

  if (isCompleted !== prevIsCompleted || showThinking !== prevShowThinking) {
    setPrevIsCompleted(isCompleted);
    setPrevShowThinking(showThinking);
    if (!showThinking) {
      setIsOpen(false);
    } else {
      setIsOpen(!isCompleted);
    }
  }

  const { totalDurationMs, totalTokens } = useMemo(() => {
    let durMs = 0;
    let tokens = 0;
    for (const e of events) {
      if (e.metadata?.durationMs) durMs += e.metadata.durationMs;
      if (e.metadata?.completionTokens) tokens += e.metadata.completionTokens;
    }
    if (durMs === 0 && events.length > 0) {
      const start = events[0].createdAt;
      const end = events[events.length - 1].createdAt;
      durMs = Math.max(0, new Date(end).getTime() - new Date(start).getTime());
    }
    return { totalDurationMs: durMs, totalTokens: tokens };
  }, [events]);

  const label = useMemo(() => {
    if (!isCompleted) return 'Thinking...';
    const dur =
      totalDurationMs > 1000
        ? `${(totalDurationMs / 1000).toFixed(1)}s`
        : `${String(totalDurationMs)}ms`;
    const parts = [`Thought for ${dur}`];
    if (totalTokens > 0) parts.push(`${String(totalTokens)} tokens`);
    return parts.join(' · ');
  }, [isCompleted, totalDurationMs, totalTokens]);

  return (
    <div className="group/activity w-full py-0.5">
      <button
        type="button"
        aria-expanded={isOpen}
        aria-controls="activity-details"
        onClick={() => {
          setIsOpen((v) => !v);
        }}
        className="text-text-muted/70 hover:text-text-main focus-visible:ring-accent/40 focus-visible:ring-offset-background flex cursor-pointer items-center gap-2 rounded-sm py-1 text-[13px] font-medium tracking-wide transition-colors outline-none select-none focus-visible:ring-1 focus-visible:ring-offset-1"
      >
        <Spinner done={isCompleted} />

        <span>{label}</span>

        {!isCompleted && (
          <span className="bg-accent/40 inline-block h-3.5 w-1.5 animate-pulse align-middle" />
        )}

        <ChevronRight
          className={`h-3 w-3 opacity-60 transition-transform duration-150 group-hover/activity:opacity-100 ${isOpen ? 'rotate-90' : ''}`}
          aria-hidden={true}
        />
      </button>

      {isOpen && (
        <div id="activity-details" className="animate-in fade-in relative mt-2 ml-1 duration-200">
          <div>
            {events.map((e, i) => {
              const isLastStreaming = isStreaming && e.id === events[events.length - 1].id;

              if (e.type === 'text' && 'role' in e.data && e.data.role === 'thought') {
                return (
                  <TimelineEvent
                    key={e.id}
                    dotColor="bg-accent"
                    isPulsing={isLastStreaming}
                    index={i}
                  >
                    <div className="text-text-muted/95 prose prose-invert prose-p:my-1.5 prose-pre:bg-surface-secondary/40 prose-pre:border prose-pre:border-border/30 prose-pre:rounded-md max-w-none text-[13.5px] leading-relaxed tracking-tight select-text">
                      <ReactMarkdown rehypePlugins={[rehypeHighlight]}>
                        {(e.data as { content: string }).content}
                      </ReactMarkdown>
                      {isLastStreaming && (
                        <span className="bg-accent/40 ml-1 inline-block h-3 w-1 animate-pulse align-middle" />
                      )}
                    </div>
                  </TimelineEvent>
                );
              }

              if (e.type === 'tool_call' || e.type === 'approval_request') {
                const reqData = e.data as {
                  name?: string;
                  request?: { toolCall?: { name?: string; arguments?: Record<string, unknown> } };
                };
                const toolName = reqData.request?.toolCall?.name ?? reqData.name ?? 'tool';
                const payload = (
                  e.type === 'approval_request' ? (reqData.request?.toolCall ?? reqData) : e.data
                ) as ACPEventToolCallData;

                const isFailed = payload.status === 'failed';
                const dynamicDotColor = isFailed
                  ? 'bg-rose-500'
                  : dotColorForTool(toolName, payload.kind);

                return (
                  <TimelineEvent
                    key={e.id}
                    dotColor={dynamicDotColor}
                    isPulsing={isLastStreaming}
                    index={i}
                  >
                    <ToolCallCard tool={toolName} payload={payload} isStreaming={isLastStreaming} />
                  </TimelineEvent>
                );
              }

              return null;
            })}
          </div>
        </div>
      )}
    </div>
  );
}
