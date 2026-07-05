import { memo, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import { Sparkles } from 'lucide-react';
import { ThinkingBlock } from './ThinkingBlock';
import type { ACPEventRow } from '@agentctl/shared';
import { useSession } from '../../../../contexts/SessionContext';
import { useProviders } from '../../../../hooks/useProviders';

interface AgentResponseProps {
  events: ACPEventRow[];
  isStreaming?: boolean;
  isActive?: boolean;
}

const REHYPE_PLUGINS = [rehypeHighlight];

const AgentResponseComponent = function AgentResponse({
  events,
  isStreaming = false,
  isActive = false,
}: AgentResponseProps) {
  const { sessionId, sessionData } = useSession();
  const { providers } = useProviders(sessionId);

  const providerIcon = useMemo(() => {
    const activeProviderId = sessionData?.session.selectedProvider;
    if (!activeProviderId) return null;
    return providers.find((p) => p.id === activeProviderId)?.icon ?? null;
  }, [providers, sessionData?.session.selectedProvider]);
  const { activityEvents, responseEvent } = useMemo(() => {
    const activity: ACPEventRow[] = [];
    let response: ACPEventRow | undefined = undefined;

    for (const e of events) {
      if (e.type === 'text' && 'role' in e.data && e.data.role === 'provider') {
        response = e;
      } else if (
        (e.type === 'text' && 'role' in e.data && e.data.role === 'thought') ||
        e.type === 'tool_call' ||
        e.type === 'approval_request'
      ) {
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
            className={`border-border bg-surface-secondary/50 flex h-8 w-8 items-center justify-center rounded-lg border transition-all duration-300 ${
              isStreaming ? 'border-accent/40 bg-accent/5' : 'group-hover/agent:border-border/80'
            }`}
          >
            {providerIcon ? (
              <img src={providerIcon} alt="" className="h-5 w-5 object-contain" />
            ) : (
              <Sparkles
                className={`h-4 w-4 ${isStreaming ? 'text-accent animate-pulse' : 'text-text-muted'}`}
              />
            )}
          </div>
        </div>

        <div className="min-w-0 flex-1">
          {hasActivity && (
            <div className="mt-[10px] mb-4">
              <ThinkingBlock
                events={activityEvents}
                isStreaming={isStreaming}
                isActive={isActive}
              />
            </div>
          )}

          {responseEvent && (
            <div className="prose prose-invert prose-pre:bg-surface-secondary/50 prose-pre:border prose-pre:border-border prose-pre:rounded-md text-text-main/90 selection:bg-accent/30 animate-in fade-in slide-in-from-top-1 max-w-none text-[15px] leading-7 tracking-normal duration-300">
              <ReactMarkdown rehypePlugins={REHYPE_PLUGINS}>
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
};

export const AgentResponse = memo(AgentResponseComponent, (prevProps, nextProps) => {
  if (prevProps.isActive !== nextProps.isActive) return false;
  if (prevProps.isStreaming !== nextProps.isStreaming) return false;
  if (prevProps.events.length !== nextProps.events.length) return false;

  for (let i = 0; i < prevProps.events.length; i++) {
    const prevEvt = prevProps.events[i];
    const nextEvt = nextProps.events[i];

    if (prevEvt.id !== nextEvt.id) return false;
    if (prevEvt.type !== nextEvt.type) return false;

    // Compare content to detect streaming text updates
    const prevContent = (prevEvt.data as { content?: string }).content;
    const nextContent = (nextEvt.data as { content?: string }).content;
    if (prevContent !== nextContent) return false;

    // Compare status updates (e.g. tool call state transitions)
    const prevStatus = (prevEvt.data as { status?: string }).status;
    const nextStatus = (nextEvt.data as { status?: string }).status;
    if (prevStatus !== nextStatus) return false;
  }

  return true;
});
