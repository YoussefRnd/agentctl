import { SessionMessage } from './SessionMessage';
import { AgentTerminals } from './AgentTerminals';
import { memo, useMemo } from 'react';
import { SubagentBlock, extractSubagentGroups } from '@/features/subagents';
import { UnifiedActivityBlock } from './UnifiedActivityBlock';
import { StreamingMarkdown } from './StreamingMarkdown';
import { TurnChangesCard } from './TurnChangesCard';
import { extractTurnChanges } from '@/features/review';
import { getAgentStreamPhase } from '../../lib/agentStreamPhase';
import { useSession, useSessionTurnState, useSessionStream } from '@/features/sessions';
import type { SessionEventRow } from '@agentctl/shared';
import { isSessionEventText, isSessionEventToolCall } from '@agentctl/shared';

interface AgentResponseProps {
  events: SessionEventRow[];
  isStreaming?: boolean;
  isActive?: boolean;
  isConnected?: boolean;
  selectedProviderId?: string | null;
}

const AgentResponseComponent = function AgentResponse({
  events,
  isStreaming = false,
  isActive = false,
  isConnected = true,
}: AgentResponseProps) {
  const { reviewData, sessionData } = useSession();
  const turn = useSessionTurnState();
  const { execution } = useSessionStream();
  const subagentsConnected =
    isConnected &&
    (execution
      ? execution.connection === 'connected'
      : !['error', 'archived'].includes(sessionData?.session.status ?? ''));
  const reviewFiles = reviewData?.files;

  const { activityEvents, responseEvent, subagentGroups, turnChanges, visibleEvents } =
    useMemo(() => {
      const activities: SessionEventRow[] = [];
      let response: SessionEventRow | undefined;
      const groups = extractSubagentGroups(events);
      const childIds = new Set(
        groups.flatMap((group) => group.childEvents.map((event) => event.id)),
      );

      const delegationToolIds = new Set(
        groups.flatMap((group) =>
          (group.delegationEvents ?? []).flatMap((event) =>
            event.type === 'tool_call' && event.data.toolCallId ? [event.data.toolCallId] : [],
          ),
        ),
      );
      const visibleEvents = events.filter(
        (event) => !childIds.has(event.id) || event.type === 'approval_request',
      );
      for (const e of visibleEvents) {
        if (e.type === 'tool_call' && e.data.toolCallId && delegationToolIds.has(e.data.toolCallId))
          continue;
        if (e.type === 'subagent_update') continue;

        if (isSessionEventText(e) && e.data.role === 'provider') {
          response = e;
        } else if (
          (isSessionEventText(e) && e.data.role === 'thought') ||
          isSessionEventToolCall(e) ||
          e.type === 'approval_request'
        ) {
          activities.push(e);
        }
      }

      const changes = extractTurnChanges(events, reviewFiles);

      return {
        visibleEvents,
        activityEvents: activities,
        responseEvent: response,
        subagentGroups: groups,
        turnChanges: changes,
      };
    }, [events, reviewFiles]);

  const sessionStatus = sessionData?.session.status;
  const isSessionActive = sessionStatus === 'running' || sessionStatus === 'needs_attention';

  const hasTerminals = visibleEvents.some(
    (event) =>
      event.type === 'terminal_created' ||
      event.type === 'terminal_output' ||
      event.type === 'terminal_exit',
  );
  const directedMessages = visibleEvents.filter(
    (event) => event.type === 'text' && event.data.role === 'session',
  );
  const hasActivity = activityEvents.length > 0;
  const isWaitingForResponse =
    !hasActivity &&
    !responseEvent &&
    subagentGroups.length === 0 &&
    (isSessionActive || turn !== null) &&
    (isStreaming || isActive);

  const hasContent =
    hasActivity ||
    directedMessages.length > 0 ||
    hasTerminals ||
    isWaitingForResponse ||
    subagentGroups.length > 0 ||
    responseEvent != null ||
    turnChanges.files.length > 0;
  const isResponding = getAgentStreamPhase(events) === 'responding';
  const providerError =
    (isStreaming || isActive) && turn?.phase === 'retrying' && turn.retry
      ? turn.retry.httpStatus === 504
        ? 'The provider timed out (HTTP 504).'
        : turn.retry.message
      : undefined;

  if (!hasContent) {
    return null;
  }

  return (
    <div data-font-ctx="chat" className="group/agent relative flex flex-col gap-2 py-3">
      {directedMessages.map(
        (event) => event.type === 'text' && <SessionMessage key={event.id} data={event.data} />,
      )}
      {(hasActivity || isWaitingForResponse || providerError) && (
        <div className="mt-0.5 mb-2.5">
          <UnifiedActivityBlock
            events={activityEvents}
            isStreaming={isStreaming && !isResponding}
            isActive={isActive}
            isWaitingForResponse={isWaitingForResponse}
            providerError={providerError}
            isResponding={isResponding}
          />
        </div>
      )}

      {hasTerminals && <AgentTerminals events={visibleEvents} />}

      {subagentGroups.length > 0 && (
        <div className="mb-4">
          <SubagentBlock
            subagentGroups={subagentGroups}
            isConnected={subagentsConnected}
            isStreaming={isStreaming}
            isActive={isActive}
          />
        </div>
      )}

      {responseEvent && (
        <div className="prose prose-invert prose-pre:bg-surface-secondary/50 prose-pre:border prose-pre:border-border prose-pre:rounded-md text-text-main/90 selection:bg-accent/30 max-w-none leading-relaxed">
          <StreamingMarkdown
            content={(responseEvent.data as { content: string }).content}
            isStreaming={isStreaming}
          />
        </div>
      )}

      {turnChanges.files.length > 0 && sessionData && (
        <TurnChangesCard summary={turnChanges} sessionId={sessionData.session.id} />
      )}
    </div>
  );
};

export const AgentResponse = memo(AgentResponseComponent, (prevProps, nextProps) => {
  if (prevProps.isConnected !== nextProps.isConnected) return false;
  if (prevProps.selectedProviderId !== nextProps.selectedProviderId) return false;
  if (prevProps.isActive !== nextProps.isActive) return false;
  if (prevProps.isStreaming !== nextProps.isStreaming) return false;
  if (prevProps.events.length !== nextProps.events.length) return false;

  for (let i = 0; i < prevProps.events.length; i++) {
    const prevEvt = prevProps.events[i];
    const nextEvt = nextProps.events[i];

    // Event snapshots are immutable. Arguments, results, approval state, and
    // metadata can all change independently of the tool's status.
    if (prevEvt !== nextEvt) return false;
  }

  return true;
});
