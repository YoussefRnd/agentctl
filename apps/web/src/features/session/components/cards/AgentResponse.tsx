import { memo, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import { Sparkles } from 'lucide-react';
import { ActivityGroup } from './ActivityGroup';
import type { ACPEventRow } from '@agentctl/shared';

interface AgentResponseProps {
  events: ACPEventRow[];
  isStreaming?: boolean;
}

export const AgentResponse = memo(function AgentResponse({
  events,
  isStreaming = false,
}: AgentResponseProps) {
  const { activityEvents, responseEvent } = useMemo(() => {
    const activity: ACPEventRow[] = [];
    let response: ACPEventRow | undefined = undefined;

    for (const e of events) {
      if (e.type === 'text' && 'role' in e.data && e.data.role === 'provider') {
        response = e;
      } else if (e.type === 'text' && 'role' in e.data && e.data.role === 'thought') {
        activity.push(e);
      } else if (e.type === 'tool_call' || e.type === 'approval_request') {
        activity.push(e);
      }
    }
    return { activityEvents: activity, responseEvent: response };
  }, [events]);

  const hasActivity = activityEvents.length > 0;

  return (
    <div className="group/agent relative flex flex-col gap-2 py-3">
      <div className="flex items-start gap-4">
        <div className="mt-1 shrink-0">
          <div
            className={`flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-surface-secondary/50 transition-all duration-300 ${
              isStreaming ? 'border-accent/40 bg-accent/5' : 'group-hover/agent:border-border/80'
            }`}
          >
            <Sparkles
              className={`h-4 w-4 ${isStreaming ? 'text-accent animate-pulse' : 'text-text-muted'}`}
            />
          </div>
        </div>

        <div className="min-w-0 flex-1">
          {hasActivity && (
            <div className="mb-4">
              <ActivityGroup
                events={activityEvents}
                isStreaming={isStreaming && !responseEvent}
                layout="nested"
              />
            </div>
          )}

          {responseEvent && (
            <div className="prose prose-invert prose-pre:bg-surface-secondary/50 prose-pre:border prose-pre:border-border prose-pre:rounded-md text-text-main/90 selection:bg-accent/30 max-w-none text-[15px] leading-7 tracking-normal animate-in fade-in slide-in-from-top-1 duration-300">
              <ReactMarkdown rehypePlugins={[rehypeHighlight]}>
                {(responseEvent.data as { content: string }).content}
              </ReactMarkdown>
              {isStreaming && (
                <span className="ml-1 inline-flex items-center gap-1">
                  <span className="bg-accent/70 h-1 w-1 animate-pulse rounded-full [animation-delay:-0.3s]" />
                  <span className="bg-accent/70 h-1 w-1 animate-pulse rounded-full [animation-delay:-0.15s]" />
                  <span className="bg-accent/70 h-1 w-1 animate-pulse rounded-full" />
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
});

