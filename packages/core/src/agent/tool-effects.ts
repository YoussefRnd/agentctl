import { structuredDiffSchema, normalizeFileChanges } from '@agentctl/shared';
import type { AgentToolCall, AgentToolEffect } from './types.js';

function effectKey(effect: AgentToolEffect): string {
  return `${effect.type}:${'path' in effect ? effect.path : effect.terminalId}`;
}

/** Derives stable product effects from an adapter-normalized tool call. */
export function deriveAgentToolEffects(call: AgentToolCall): AgentToolEffect[] {
  const effects: AgentToolEffect[] = [];
  let hasStructuredDiff = false;
  const paths = (call.locations ?? [])
    .map((location) => location.path)
    .filter((path): path is string => Boolean(path));

  for (const content of call.content ?? []) {
    const structured = content.type === 'diff' ? structuredDiffSchema.safeParse(content) : null;
    if (structured?.success) {
      hasStructuredDiff = true;
      for (const change of normalizeFileChanges(structured.data)) {
        effects.push({
          type: change.operation === 'delete' ? 'file_deleted' : 'file_modified',
          path: change.path,
          ...(change.stats ? { stats: change.stats } : {}),
        });
      }
    } else if (content.type === 'diff' && content.path) {
      effects.push({
        type: 'file_modified',
        path: content.path,
        oldText: content.oldText,
        newText: content.newText,
      });
    } else if (content.type === 'terminal' && content.terminalId) {
      effects.push({ type: 'terminal', terminalId: content.terminalId });
    }
  }

  // Structured changes describe the operation; locations only locate related content.
  for (const path of hasStructuredDiff ? [] : paths) {
    if (call.kind === 'read') effects.push({ type: 'file_read', path });
    if (call.kind === 'edit' || call.kind === 'move') {
      effects.push({ type: 'file_modified', path });
    }
    if (call.kind === 'delete') effects.push({ type: 'file_deleted', path });
  }

  const unique = new Map<string, AgentToolEffect>();
  for (const effect of effects) {
    const key = effectKey(effect);
    const existing = unique.get(key);
    if (!existing) unique.set(key, effect);
    else if (
      (existing.type === 'file_modified' || existing.type === 'file_deleted') &&
      (effect.type === 'file_modified' || effect.type === 'file_deleted') &&
      effect.stats
    ) {
      existing.stats = {
        additions: (existing.stats?.additions ?? 0) + effect.stats.additions,
        deletions: (existing.stats?.deletions ?? 0) + effect.stats.deletions,
      };
    }
  }
  return Array.from(unique.values());
}
