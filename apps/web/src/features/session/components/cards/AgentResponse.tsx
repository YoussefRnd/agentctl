import { memo, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { Square } from 'lucide-react';
import { api } from '@agentctl/api-client';
import { StreamingDots } from '@/shared/StreamingDots';
import { ProviderIconUrl } from '@/shared/ProviderIcon';
import { SubagentBlock } from './SubagentBlock';
import { ThinkingBlock } from './ThinkingBlock';
import { MarkdownCodeBlock } from './MarkdownCodeBlock';
import type { SubagentGroup } from './subagentBlockUtils';
import type { ACPEventRow, ACPEventToolCallData } from '@agentctl/shared';
import { useSession } from '../../../../contexts/SessionContext';
import { useProviders } from '../../../../hooks/useProviders';

const SUBAGENT_ARG_KEYS = new Set(['description', 'prompt', 'subagent_type']);

function hasSubagentArgs(data: ACPEventToolCallData): boolean {
  const args = data.arguments;
  if (!args) return false;
  for (const key of SUBAGENT_ARG_KEYS) {
    if (typeof args[key] === 'string') return true;
  }
  return false;
}

function getSubagentScope(data: ACPEventToolCallData): string {
  const args = data.arguments;
  if (args) {
    if (typeof args.description === 'string') return args.description;
    if (typeof args.prompt === 'string') return args.prompt;
  }
  return data.name;
}

interface AgentResponseProps {
  events: ACPEventRow[];
  isStreaming?: boolean;
  isActive?: boolean;
  selectedProviderId?: string | null;
}

const REHYPE_PLUGINS = [remarkGfm, rehypeHighlight];

const AgentResponseComponent = function AgentResponse({
  events,
  isStreaming = false,
  isActive = false,
  selectedProviderId,
}: AgentResponseProps) {
  const { sessionId, sessionData } = useSession();
  const { providers } = useProviders(sessionId);

  const providerIcon = useMemo(() => {
    if (!selectedProviderId) return null;
    return providers.find((p) => p.id === selectedProviderId)?.agent?.icon ?? null;
  }, [providers, selectedProviderId]);

  const { activityEvents, responseEvent, subagentGroups } = useMemo(() => {
    const activity: ACPEventRow[] = [];
    let response: ACPEventRow | undefined;

    const toolCallGroups = new Map<string, ACPEventRow[]>();
    const nativelyEmitted = new Map<string, ACPEventRow[]>();

    for (const e of events) {
      if (e.type === 'tool_call') {
        const tcData = e.data;
        if (tcData.toolCallId && hasSubagentArgs(tcData)) {
          const group = toolCallGroups.get(tcData.toolCallId);
          if (group) {
            group.push(e);
          } else {
            toolCallGroups.set(tcData.toolCallId, [e]);
          }
        }
      }

      if (e.type === 'subagent_update') {
        const data = e.data as { subagentId: string };
        if (!nativelyEmitted.has(data.subagentId)) {
          nativelyEmitted.set(data.subagentId, []);
        }
      } else if (e.parentEventId != null) {
        const parentData = events.find(
          (pe) => pe.id === e.parentEventId && pe.type === 'subagent_update',
        );
        if (parentData) {
          const data = parentData.data as { subagentId: string };
          const children = nativelyEmitted.get(data.subagentId);
          if (children) {
            children.push(e);
            continue;
          }
        }
      }

      if (e.type === 'tool_call') {
        const tcData = e.data;
        if (tcData.toolCallId && toolCallGroups.has(tcData.toolCallId)) {
          continue;
        }
      }

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

    const groups: SubagentGroup[] = [];

    for (const [, tcEvents] of toolCallGroups) {
      const first = tcEvents[0];
      const last = tcEvents[tcEvents.length - 1];
      const firstData = first.data as ACPEventToolCallData;
      const lastData = last.data as ACPEventToolCallData;

      const lastTcIndex = events.indexOf(last);
      const hasFollowingActivity = events.slice(lastTcIndex + 1).some((e) => {
        if (e.type === 'tool_call') {
          const ed = e.data;
          if (ed.toolCallId && toolCallGroups.has(ed.toolCallId)) return false;
        }
        return true;
      });

      const status =
        lastData.status === 'completed' || lastData.status === 'failed'
          ? lastData.status
          : hasFollowingActivity
            ? 'completed'
            : 'running';

      groups.push({
        subagentEvent: {
          ...first,
          type: 'subagent_update' as const,
          data: {
            subagentId: `tool-${firstData.toolCallId ?? 'unknown'}`,
            name: firstData.name,
            scope: getSubagentScope(firstData),
            status,
            result: status === 'completed' ? { summary: 'Task completed' } : undefined,
          },
          parentEventId: undefined,
        },
        childEvents: tcEvents.slice(1).map((e) => ({
          ...e,
          parentEventId: first.id,
        })),
      });
    }

    for (const e of events) {
      if (e.type !== 'subagent_update') continue;
      const data = e.data as { subagentId: string };
      groups.push({
        subagentEvent: e,
        childEvents: nativelyEmitted.get(data.subagentId) ?? [],
      });
    }

    return { activityEvents: activity, responseEvent: response, subagentGroups: groups };
  }, [events]);

  const hasActivity = activityEvents.length > 0;
  const isRunning = sessionData?.session.status === 'running';
  const showStopButton = (isStreaming || isActive) && isRunning;

  return (
    <div data-font-ctx="chat" className="group/agent relative flex flex-col gap-2 py-3">
      <div className="flex items-start gap-3">
        <div className="mt-1 shrink-0">
          <div
            className={`border-border bg-surface-secondary/50 flex h-8 w-8 items-center justify-center rounded-lg border transition-all duration-300 ${
              isStreaming ? 'border-accent/40 bg-accent/5' : 'group-hover/agent:border-border/80'
            }`}
          >
            <ProviderIconUrl
              url={providerIcon}
              className={isStreaming ? 'text-accent animate-pulse' : 'text-text-muted'}
            />
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

          {subagentGroups.length > 0 && (
            <div className="mb-4">
              <SubagentBlock
                subagentGroups={subagentGroups}
                isStreaming={isStreaming}
                isActive={isActive}
              />
            </div>
          )}

          {responseEvent && (
            <div className="prose prose-invert prose-pre:bg-surface-secondary/50 prose-pre:border prose-pre:border-border prose-pre:rounded-md text-text-main/90 selection:bg-accent/30 max-w-none text-[15px] leading-7 tracking-normal">
              <ReactMarkdown rehypePlugins={REHYPE_PLUGINS} components={{ pre: MarkdownCodeBlock }}>
                {(responseEvent.data as { content: string }).content}
              </ReactMarkdown>
              {isStreaming && <StreamingDots />}
            </div>
          )}

          {showStopButton && (
            <div className="mt-3 flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  if (sessionId) {
                    void api.cancelSession({ params: { id: sessionId }, body: {} });
                  }
                }}
                className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-1.5 text-xs font-semibold text-rose-400 shadow-sm transition-all hover:bg-rose-500/20 active:scale-95"
                title="Stop generation"
              >
                <Square className="h-3.5 w-3.5 fill-current" />
                <span>Stop generation</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export const AgentResponse = memo(AgentResponseComponent, (prevProps, nextProps) => {
  if (prevProps.selectedProviderId !== nextProps.selectedProviderId) return false;
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
