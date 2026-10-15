import type { AgentUpdate } from '../../agent/types.js';
import { acpPayloadBytes } from '../transport/limits.js';
import { boundedText } from './bounded-text.js';
import { displayAcpContent } from './content.js';

interface CompactionState {
  summary: string;
  status: string;
  error?: string | null;
  metadata?: Record<string, unknown> | null;
}
export type CompactionNotification =
  | {
      sessionUpdate: 'compaction_update';
      compactionId: string;
      status: string;
      summary?: unknown[] | null;
      error?: string | null;
      _meta?: Record<string, unknown> | null;
    }
  | { sessionUpdate: 'compaction_summary_chunk'; compactionId: string; content: unknown };

/** Both versions use omission = retain, null = clear, value = replace. */
export function createCompactionProjector() {
  const states = new Map<string, CompactionState>();
  return (update: CompactionNotification): AgentUpdate[] => {
    const previous = states.get(update.compactionId);
    const state: CompactionState = {
      ...previous,
      summary: previous?.summary ?? '',
      status: previous?.status ?? 'in_progress',
    };
    if (update.sessionUpdate === 'compaction_summary_chunk') {
      state.summary = boundedText(state.summary + displayAcpContent(update.content), 64 * 1024);
    } else {
      state.status = update.status;
      if (update.summary !== undefined)
        state.summary = boundedText(
          update.summary?.map(displayAcpContent).join('\n') ?? '',
          64 * 1024,
        );
      if (update.error !== undefined)
        state.error = update.error === null ? null : boundedText(update.error, 2048);
      if (update._meta !== undefined) {
        if (acpPayloadBytes(update._meta) > 64 * 1024)
          throw new Error('ACP compaction metadata budget exceeded');
        state.metadata = update._meta;
      }
    }
    if (!previous && states.size >= 128) states.delete(states.keys().next().value!);
    states.set(update.compactionId, state);
    return [
      {
        type: 'tool_call',
        contentOperation: 'replace',
        call: {
          toolCallId: `acp-compaction:${update.compactionId}`,
          name: 'compact_context',
          title: 'Compact context',
          kind: 'think',
          status: state.status,
          content: [
            { type: 'content', content: { type: 'text', text: state.error || state.summary } },
          ],
          rawOutput: {
            summary: state.summary,
            ...(state.error != null ? { error: state.error } : {}),
            ...(state.metadata != null ? { metadata: state.metadata } : {}),
          },
        },
      },
    ];
  };
}
