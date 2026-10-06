import type {
  CompactionUpdate,
  CompactionSummaryChunk,
} from '@agentclientprotocol/sdk/experimental/v2';
import type { AgentUpdate } from '../../agent/types.js';
import { displayAcpContent } from '../protocol/content.js';
import { boundedTerminalOutput } from './terminals.js';

export function createCompactionProjector() {
  const summaries = new Map<string, string>();
  return (
    update:
      | (CompactionUpdate & { sessionUpdate: 'compaction_update' })
      | (CompactionSummaryChunk & { sessionUpdate: 'compaction_summary_chunk' }),
  ): AgentUpdate[] => {
    if (!summaries.has(update.compactionId) && summaries.size >= 128)
      summaries.delete(summaries.keys().next().value!);
    const summary = boundedTerminalOutput(
      update.sessionUpdate === 'compaction_update'
        ? (update.summary?.map(displayAcpContent).join('\n') ??
            summaries.get(update.compactionId) ??
            '')
        : (summaries.get(update.compactionId) ?? '') + displayAcpContent(update.content),
    );
    summaries.set(update.compactionId, summary);
    const status =
      update.sessionUpdate === 'compaction_summary_chunk'
        ? 'in_progress'
        : update.status === 'completed'
          ? 'completed'
          : update.status === 'failed' || update.status === 'cancelled'
            ? 'failed'
            : 'in_progress';
    const error = update.sessionUpdate === 'compaction_update' ? update.error : undefined;
    return [
      {
        type: 'tool_call',
        contentOperation: 'replace',
        call: {
          toolCallId: `acp-compaction:${update.compactionId}`,
          name: 'compact_context',
          title: 'Compact context',
          kind: 'think',
          status,
          content: [{ type: 'content', content: { type: 'text', text: error || summary } }],
          rawOutput: { summary, ...(error ? { error: error.slice(0, 2048) } : {}) },
        },
      },
    ];
  };
}
