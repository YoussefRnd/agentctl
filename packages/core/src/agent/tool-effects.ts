import type { AgentToolCall, AgentToolEffect } from './types.js';

function effectKey(effect: AgentToolEffect): string {
  return `${effect.type}:${'path' in effect ? effect.path : effect.terminalId}`;
}

/** Derives stable product effects from an adapter-normalized tool call. */
export function deriveAgentToolEffects(call: AgentToolCall): AgentToolEffect[] {
  const effects: AgentToolEffect[] = [];
  const paths = (call.locations ?? [])
    .map((location) => location.path)
    .filter((path): path is string => Boolean(path));

  for (const content of call.content ?? []) {
    if (content.type === 'diff' && content.path) {
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

  for (const path of paths) {
    if (call.kind === 'read') effects.push({ type: 'file_read', path });
    if (call.kind === 'edit' || call.kind === 'move') {
      effects.push({ type: 'file_modified', path });
    }
    if (call.kind === 'delete') effects.push({ type: 'file_deleted', path });
  }

  const unique = new Map<string, AgentToolEffect>();
  for (const effect of effects) {
    const key = effectKey(effect);
    if (!unique.has(key)) unique.set(key, effect);
  }
  return Array.from(unique.values());
}
