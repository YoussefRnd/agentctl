import { useState, useMemo, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { ChevronRight } from 'lucide-react';
import { Spinner } from '@/components/ui/Spinner';
import { useSettings } from '@/hooks/useSettings';
import { useSession } from '@/contexts/SessionContext';
import { ToolCallCard } from './ToolCallCard';
import { TimelineEvent } from './TimelineEvent';
import { getToolMeta } from '@/utils/toolColors';
import type { ACPEventRow, ACPEventToolCallData } from '@agentctl/shared';

interface ThinkingBlockProps {
  events: ACPEventRow[];
  isStreaming?: boolean;
  isActive?: boolean;
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
  const prevIsCompletedRef = useRef(isCompleted);
  const prevShowThinkingRef = useRef(showThinking);

  useEffect(() => {
    if (
      isCompleted !== prevIsCompletedRef.current ||
      showThinking !== prevShowThinkingRef.current
    ) {
      prevIsCompletedRef.current = isCompleted;
      prevShowThinkingRef.current = showThinking;
      if (!showThinking) {
        setIsOpen(false);
      } else {
        setIsOpen(!isCompleted);
      }
    }
  }, [isCompleted, showThinking]);

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
        <div id="activity-details" className="relative mt-2 ml-1">
          <div>
            {events.map((e) => {
              const isLastStreaming = isStreaming && e.id === events[events.length - 1].id;

              if (e.type === 'text' && 'role' in e.data && e.data.role === 'thought') {
                return (
                  <TimelineEvent key={e.id} dotColor="bg-accent" isPulsing={isLastStreaming}>
                    <div className="text-text-muted/95 prose prose-invert prose-p:my-1.5 prose-pre:bg-surface-secondary/40 prose-pre:border prose-pre:border-border/30 prose-pre:rounded-md max-w-none text-[13.5px] leading-relaxed tracking-tight select-text">
                      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
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
                  : getToolMeta(payload.kind, toolName).dotColor;

                return (
                  <TimelineEvent key={e.id} dotColor={dynamicDotColor} isPulsing={isLastStreaming}>
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
