import { memo, useMemo } from 'react';
import { SubagentBlock } from './SubagentBlock';
import { UnifiedActivityBlock } from './UnifiedActivityBlock';
import { StreamingMarkdown } from './StreamingMarkdown';
import { TurnChangesCard } from './TurnChangesCard';
import { isSubagentToolCall, extractSubagentGroups } from './subagentBlockUtils';
import { extractTurnChanges } from '../../lib/turnChanges';
import { useSession } from '../../../../contexts/SessionContext';
import type { SessionEventRow } from '@agentctl/shared';
import {
  isSessionEventText,
  isSessionEventToolCall,
  isSessionEventSubagentUpdate,
} from '@agentctl/shared';

interface AgentResponseProps {
  events: SessionEventRow[];
  isStreaming?: boolean;
  isActive?: boolean;
  selectedProviderId?: string | null;
}

const AgentResponseComponent = function AgentResponse({
  events,
  isStreaming = false,
  isActive = false,
}: AgentResponseProps) {
  const { reviewData, sessionData } = useSession();
  const reviewFiles = reviewData?.files;

  const { activityEvents, responseEvent, subagentGroups, turnChanges } = useMemo(() => {
    const activities: SessionEventRow[] = [];
    let response: SessionEventRow | undefined;

    const idToEvent = new Map<number, SessionEventRow>();
    for (let i = 0; i < events.length; i++) {
      idToEvent.set(events[i].id, events[i]);
    }

    const subagentToolCallIds = new Set<string>();

    for (const e of events) {
      if (isSessionEventToolCall(e)) {
        const tcData = e.data;
        if (tcData.toolCallId && isSubagentToolCall(tcData)) {
          subagentToolCallIds.add(tcData.toolCallId);
        }
      }
    }

    for (const e of events) {
      if (isSessionEventToolCall(e)) {
        const tcData = e.data;
        if (tcData.toolCallId && subagentToolCallIds.has(tcData.toolCallId)) {
          continue;
        }
      }

      if (e.parentEventId != null) {
        const parentData = idToEvent.get(e.parentEventId);
        if (parentData && isSessionEventSubagentUpdate(parentData)) {
          continue;
        }
      }

      if (isSessionEventSubagentUpdate(e)) {
        continue;
      }

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

    const groups = extractSubagentGroups(events);
    const changes = extractTurnChanges(events, reviewFiles);

    return {
      activityEvents: activities,
      responseEvent: response,
      subagentGroups: groups,
      turnChanges: changes,
    };
  }, [events, reviewFiles]);

  const sessionStatus = sessionData?.session.status;
  const isSessionActive = sessionStatus === 'running' || sessionStatus === 'needs_attention';

  const hasActivity = activityEvents.length > 0;
  const isInitialThinking =
    !hasActivity &&
    !responseEvent &&
    subagentGroups.length === 0 &&
    isSessionActive &&
    (isStreaming || isActive);

  const hasContent =
    hasActivity ||
    isInitialThinking ||
    subagentGroups.length > 0 ||
    responseEvent != null ||
    turnChanges.files.length > 0;

  if (!hasContent) {
    return null;
  }

  return (
    <div data-font-ctx="chat" className="group/agent relative flex flex-col gap-2 py-3">
      {(hasActivity || isInitialThinking) && (
        <div className="mt-0.5 mb-2.5">
          <UnifiedActivityBlock
            events={activityEvents}
            isStreaming={isStreaming}
            isActive={isActive}
            isInitialThinking={isInitialThinking}
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
