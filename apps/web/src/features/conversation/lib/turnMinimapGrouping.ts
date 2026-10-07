import type { SessionEventRow, SessionTurnAnchor } from '@agentctl/shared';
import { isSessionEventText, extractTurnSummary } from '@agentctl/shared';
import { extractTurnChanges, type ReviewFile } from '@/features/review';
import { orderConversationEvents } from './orderConversationEvents';

export { extractTurnSummary } from '@agentctl/shared';

export interface ConversationTurn {
  id: string;
  turnIndex: number;
  userEvent: SessionEventRow;
  userPrompt: string;
  agentEvents: SessionEventRow[];
  agentResponseText?: string;
  turnSummary: string;
  diffStats: {
    additions: number;
    deletions: number;
    filesCount: number;
  };
  modelName?: string;
  providerName?: string;
  providerIcon?: string;
  userName?: string;
  timestamp: string;
  isStreaming?: boolean;
}

/** Complete timeline anchors remain stable while only message pages are loaded. */
export function mergeTurnIndex(
  anchors: SessionTurnAnchor[],
  loadedTurns: ConversationTurn[],
  sessionId: string,
  sessionMeta?: Pick<ConversationTurn, 'modelName' | 'providerName' | 'providerIcon' | 'userName'>,
): ConversationTurn[] {
  const byId = new Map(
    anchors.map((anchor): [number, ConversationTurn] => [
      anchor.eventId,
      {
        id: `turn-${anchor.eventId}`,
        turnIndex: 0,
        userEvent: {
          id: anchor.eventId,
          sessionId,
          type: 'text',
          data: { role: 'user', content: anchor.prompt },
          createdAt: new Date(anchor.timestamp),
        },
        userPrompt: anchor.prompt,
        agentEvents: [],
        turnSummary: anchor.summary ?? '',
        diffStats: anchor.diffStats ?? { additions: 0, deletions: 0, filesCount: 0 },
        ...sessionMeta,
        timestamp: anchor.timestamp,
      },
    ]),
  );
  const anchorsById = new Map(anchors.map((anchor) => [anchor.eventId, anchor]));
  for (const turn of loadedTurns) {
    const anchor = anchorsById.get(turn.userEvent.id);
    // Pages can contain only part of a turn. Keep its complete indexed summary
    // until all saved output is present, then follow loaded and live output.
    const useIndexedSummary =
      anchor?.eventCount !== undefined
        ? turn.agentEvents.length < anchor.eventCount
        : turn.agentEvents.length === 0;
    byId.set(turn.userEvent.id, {
      ...turn,
      turnSummary: useIndexedSummary ? (anchor?.summary ?? turn.turnSummary) : turn.turnSummary,
      diffStats: anchor?.diffStats ?? turn.diffStats,
    });
  }
  const persisted = [...byId.values()]
    .filter((turn) => turn.userEvent.id >= 0)
    .sort((a, b) => a.userEvent.id - b.userEvent.id);
  const optimistic = loadedTurns.filter((turn) => turn.userEvent.id < 0);
  return [...persisted, ...optimistic].map((turn, turnIndex) => ({ ...turn, turnIndex }));
}

/**
 * Groups session events into structured ConversationTurn objects for the minimap.
 */
export function groupConversationTurns(
  events: SessionEventRow[],
  reviewFiles?: ReviewFile[],
  sessionMeta?: {
    modelName?: string;
    providerName?: string;
    providerIcon?: string;
    userName?: string;
  },
): ConversationTurn[] {
  const turns: ConversationTurn[] = [];
  let currentTurn: {
    userEvent: SessionEventRow;
    userPrompt: string;
    agentEvents: SessionEventRow[];
  } | null = null;

  for (const e of orderConversationEvents(events)) {
    // Skip internal system updates
    const statusVal = (e.data as { status?: string } | null)?.status;
    const isHidden =
      e.type === 'status' &&
      typeof statusVal === 'string' &&
      ['available_commands_update', 'config_option_update', 'session_info_update'].includes(
        statusVal,
      );
    if (isHidden) continue;

    const isUser = isSessionEventText(e) && e.data.role === 'user' && !e.metadata?.nativeSessionId;

    if (isUser) {
      if (currentTurn) {
        const changes = extractTurnChanges(currentTurn.agentEvents, reviewFiles);
        const summary = extractTurnSummary(currentTurn.agentEvents);
        turns.push({
          id: `turn-${String(currentTurn.userEvent.id)}`,
          turnIndex: turns.length,
          userEvent: currentTurn.userEvent,
          userPrompt: currentTurn.userPrompt,
          agentEvents: currentTurn.agentEvents,
          turnSummary: summary,
          diffStats: {
            additions: changes.totalAdditions,
            deletions: changes.totalDeletions,
            filesCount: changes.files.length,
          },
          modelName: sessionMeta?.modelName,
          providerName: sessionMeta?.providerName,
          providerIcon: sessionMeta?.providerIcon,
          userName: sessionMeta?.userName || 'User',
          timestamp: currentTurn.userEvent.createdAt
            ? new Date(currentTurn.userEvent.createdAt).toISOString()
            : new Date().toISOString(),
          isStreaming: false,
        });
      }

      currentTurn = {
        userEvent: e,
        userPrompt: e.data.content?.trim() || '',
        agentEvents: [],
      };
    } else {
      if (currentTurn) {
        currentTurn.agentEvents.push(e);
      }
    }
  }

  if (currentTurn) {
    const changes = extractTurnChanges(currentTurn.agentEvents, reviewFiles);
    const summary = extractTurnSummary(currentTurn.agentEvents);
    turns.push({
      id: `turn-${String(currentTurn.userEvent.id)}`,
      turnIndex: turns.length,
      userEvent: currentTurn.userEvent,
      userPrompt: currentTurn.userPrompt,
      agentEvents: currentTurn.agentEvents,
      turnSummary: summary,
      diffStats: {
        additions: changes.totalAdditions,
        deletions: changes.totalDeletions,
        filesCount: changes.files.length,
      },
      modelName: sessionMeta?.modelName,
      providerName: sessionMeta?.providerName,
      providerIcon: sessionMeta?.providerIcon,
      userName: sessionMeta?.userName || 'User',
      timestamp: currentTurn.userEvent.createdAt
        ? new Date(currentTurn.userEvent.createdAt).toISOString()
        : new Date().toISOString(),
      isStreaming: false,
    });
  }

  return turns;
}
