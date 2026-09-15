import type { SessionEventRow } from '@agentctl/shared';
import { isSessionEventText, isSessionEventToolCall } from '@agentctl/shared';
import { extractTurnChanges, type ReviewFile } from '@/features/review';

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

/**
 * Extracts a concise summary from agent events in a turn.
 */
export function extractTurnSummary(agentEvents: SessionEventRow[]): string {
  // 1. Look for provider text response
  for (let i = agentEvents.length - 1; i >= 0; i--) {
    const e = agentEvents[i];
    if (
      isSessionEventText(e) &&
      (e.data.role === 'provider' || (e.data as { role?: string }).role === 'assistant')
    ) {
      const text = e.data.content?.trim();
      if (text) {
        // Return first clean paragraph / sentence
        const firstParagraph = text.split(/\n\s*\n/)[0]?.trim() ?? text;
        return firstParagraph;
      }
    }
  }

  // 2. Look for plan_update
  for (const e of agentEvents) {
    if (e.type === 'plan_update') {
      const planData = e.data as { plan?: { name?: string; text?: string }[] } | undefined;
      if (Array.isArray(planData?.plan) && planData.plan.length > 0) {
        const firstStep = planData.plan.find((p) => p.name || p.text);
        if (firstStep) return firstStep.name || firstStep.text || '';
      }
    }
  }

  // 3. Look for tool call activities
  const toolNames = agentEvents
    .filter(isSessionEventToolCall)
    .map(
      (e) =>
        (e.data as { title?: string; name?: string }).title ||
        (e.data as { title?: string; name?: string }).name,
    )
    .filter(Boolean);

  if (toolNames.length > 0) {
    const unique = Array.from(new Set(toolNames));
    if (unique.length === 1) {
      return `Executed ${unique[0]}`;
    }
    return `Executed ${unique.slice(0, 2).join(', ')}${unique.length > 2 ? ` and ${unique.length - 2} other actions` : ''}`;
  }

  // 4. Look for thought updates
  for (const e of agentEvents) {
    if (isSessionEventText(e) && e.data.role === 'thought') {
      const text = e.data.content?.trim();
      if (text) {
        const firstLine = text.split(/\n+/)[0]?.trim() ?? text;
        return firstLine;
      }
    }
  }

  if (agentEvents.length === 0) {
    return 'Awaiting agent response...';
  }

  return 'No response generated';
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

  for (const e of events) {
    // Skip internal system updates
    const statusVal = (e.data as { status?: string } | null)?.status;
    const isHidden =
      e.type === 'status' &&
      typeof statusVal === 'string' &&
      [
        'available_commands_update',
        'config_option_update',
        'session_info_update',
        'turn_end',
      ].includes(statusVal);
    if (isHidden) continue;

    const isUser = isSessionEventText(e) && e.data.role === 'user';

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
