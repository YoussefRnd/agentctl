import { useState, useMemo, useId } from 'react';
import { ChevronRight } from 'lucide-react';
import { ThinkingSpinner } from '@/shared';
import { useSettings } from '@/features/settings';
import { useSession } from '@/features/sessions';
import { formatTokenCount } from '@/shared/lib/formatTokenCount';
import { StreamingMarkdown } from '../../../../shared/markdown/ui/StreamingMarkdown';
import type { SessionEventRow } from '@agentctl/shared';

interface ThinkingBlockProps {
  events: SessionEventRow[];
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
  const detailsId = useId();

  const sessionStatus = sessionData?.session.status;
  const isSessionActive = sessionStatus === 'running' || sessionStatus === 'needs_attention';
  const isCompleted = !isActive || !isSessionActive;

  const [userToggled, setUserToggled] = useState<boolean | null>(null);
  const isOpen = userToggled ?? (!isCompleted && showThinking);

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
    if (totalTokens > 0) parts.push(`${formatTokenCount(totalTokens)} tokens`);
    return parts.join(' · ');
  }, [isCompleted, totalDurationMs, totalTokens]);

  const toggle = () => {
    if (events.length === 0) return;
    setUserToggled(!isOpen);
  };

  return (
    <div className="w-full py-0.5">
      <button
        type="button"
        aria-expanded={isOpen}
        aria-controls={detailsId}
        onClick={toggle}
        disabled={events.length === 0}
        className={`text-text-muted/80 hover:text-text-main focus-visible:ring-accent/40 group/activity-btn inline-flex items-center gap-2 rounded-md text-[13px] font-normal tracking-tight transition-colors outline-none select-none focus-visible:ring-2 ${
          events.length > 0 ? 'cursor-pointer' : 'cursor-default'
        }`}
      >
        <ThinkingSpinner done={isCompleted} className="text-accent text-[15px]" />
        <span>{label}</span>
        {events.length > 0 && (
          <ChevronRight
            className={`h-3.5 w-3.5 opacity-60 transition-transform duration-150 group-hover/activity-btn:opacity-100 ${
              isOpen ? 'rotate-90' : ''
            }`}
            aria-hidden={true}
          />
        )}
      </button>

      {isOpen && (
        <div id={detailsId} className="mt-2 space-y-2">
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
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
