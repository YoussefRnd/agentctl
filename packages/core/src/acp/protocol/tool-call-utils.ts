export function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

/**
 * Extracts tool arguments from an ACP `rawInput` payload. Accepts either a
 * nested `{ arguments: {...} }` shape or a flat arguments object.
 */
export function toolArgumentsFrom(rawInput: unknown): Record<string, unknown> | undefined {
  const input = asRecord(rawInput);
  if (!input) return undefined;
  const args = asRecord(input.arguments);
  if (args) return args;
  const rest = { ...input };
  delete rest.name;
  delete rest.arguments;
  return rest;
}

/**
 * Resolves a human/domain tool name from an ACP tool-call payload.
 * Prefers the `__`-prefixed id convention (`serverId__toolName`), then
 * `rawInput.name`, then kind.
 */
export function toolNameFrom(toolCall: {
  toolCallId: string;
  kind?: unknown;
  rawInput?: unknown;
  title?: string | null;
}): string {
  const input = asRecord(toolCall.rawInput);
  if (typeof input?.name === 'string' && input.name) return input.name;
  const idParts = toolCall.toolCallId.split('__');
  if (idParts.length > 1 && idParts[0]) {
    return idParts[0];
  }
  if (typeof toolCall.kind === 'string' && toolCall.kind) {
    return toolCall.kind;
  }
  if (typeof toolCall.title === 'string' && toolCall.title) {
    return toolCall.title;
  }
  return 'tool';
}
