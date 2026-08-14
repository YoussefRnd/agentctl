import { useState, useMemo, useRef, useEffect } from 'react';
import { ChevronRight } from 'lucide-react';
import { Spinner, StreamingDots } from '@/shared';
import { useSettings } from '@/hooks/useSettings';
import { useSession } from '@/contexts/SessionContext';
import { StreamingMarkdown } from './StreamingMarkdown';
import type { ACPEventRow } from '@agentctl/shared';

interface ThinkingBlockProps {
  events: ACPEventRow[];
  isStreaming?: boolean;
  isActive?: boolean;
}

function formatTokens(count: number): string {
  if (count >= 1000) return `${(count / 1000).toFixed(1)}k`;
  return String(count);
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
  const userToggledRef = useRef(false);
  const prevShowThinkingRef = useRef(showThinking);

  useEffect(() => {
    if (showThinking !== prevShowThinkingRef.current) {
      prevShowThinkingRef.current = showThinking;
      if (!showThinking) {
        setIsOpen(false);
      } else if (!isCompleted) {
        setIsOpen(true);
      }
      return;
    }
    if (isCompleted && !userToggledRef.current) {
      setIsOpen(false);
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
    if (!isCompleted) return 'Thinking';
    const dur =
      totalDurationMs > 1000
        ? `${(totalDurationMs / 1000).toFixed(1)}s`
        : `${String(totalDurationMs)}ms`;
    const parts = [`Thought for ${dur}`];
    if (totalTokens > 0) parts.push(`${formatTokens(totalTokens)} tokens`);
    return parts.join(' · ');
  }, [isCompleted, totalDurationMs, totalTokens]);

  const toggle = () => {
    if (events.length === 0) return;
    userToggledRef.current = true;
    setIsOpen((v) => !v);
  };

  return (
    <div className="group/activity w-full py-0.5">
      <button
        type="button"
        aria-expanded={isOpen}
        aria-controls="activity-details"
        onClick={toggle}
        className="border-border/30 bg-surface-secondary/30 text-text-muted/80 hover:text-text-main hover:border-border/50 focus-visible:ring-accent/40 focus-visible:ring-offset-background flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1 text-[12px] font-medium tracking-wide transition-all outline-none select-none focus-visible:ring-1 focus-visible:ring-offset-1"
      >
        <Spinner done={isCompleted} />

        <span>{label}</span>

        {!isCompleted && <StreamingDots className="ml-0.5" />}

        {events.length > 0 && (
          <ChevronRight
            className={`h-3 w-3 opacity-60 transition-transform duration-150 group-hover/activity:opacity-100 ${isOpen ? 'rotate-90' : ''}`}
            aria-hidden={true}
          />
        )}
      </button>

      {isOpen && (
        <div
          id="activity-details"
          className="animate-in fade-in slide-in-from-top-1 mt-2 space-y-2 duration-150"
        >
          {events.map((e) => {
            const isLastStreaming = isStreaming && e.id === events[events.length - 1].id;
            return (
              <div
                key={e.id}
                className="border-accent/30 bg-surface-secondary/25 rounded-r-lg border-l-2 py-2 pr-3 pl-3"
              >
                <div className="text-text-muted/95 prose prose-invert prose-p:my-1.5 prose-pre:bg-surface-secondary/40 prose-pre:border prose-pre:border-border/30 prose-pre:rounded-md max-w-none text-[13px] leading-relaxed tracking-tight select-text">
                  <StreamingMarkdown
                    content={(e.data as { content: string }).content}
                    isStreaming={isLastStreaming}
                  />
                  {isLastStreaming && (
                    <span className="bg-accent/40 ml-1 inline-block h-3 w-1 animate-pulse align-middle" />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
