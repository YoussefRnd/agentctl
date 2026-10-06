export function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

/**
 * Extracts tool arguments from an ACP `rawInput` payload. Accepts either a
 * nested `{ arguments: {...} }` shape, a flat arguments object, or a JSON string.
 */
export function toolArgumentsFrom(rawInput: unknown): Record<string, unknown> | undefined {
  let input = asRecord(rawInput);
  if (!input && typeof rawInput === 'string') {
    const trimmed = rawInput.trim();
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      try {
        input = asRecord(JSON.parse(trimmed));
      } catch {
        return undefined;
      }
    }
  }
  if (!input) return undefined;

  let args = asRecord(input.arguments);
  if (!args && typeof input.arguments === 'string') {
    const trimmed = input.arguments.trim();
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      try {
        args = asRecord(JSON.parse(trimmed));
      } catch {
        // Not a JSON object
      }
    }
  }
  if (args) return args;

  const rest = { ...input };
  delete rest.name;
  delete rest.arguments;
  return rest;
}

/**
 * Resolves a human/domain tool name from an ACP tool-call payload.
 * Names are informational. Prefer an advertised name, then rawInput.name,
 * then kind/title. A tool-call ID is opaque and is never interpreted as a name.
 */
export function toolNameFrom(toolCall: {
  toolCallId: string;
  name?: unknown;
  kind?: unknown;
  rawInput?: unknown;
  title?: string | null;
}): string {
  if (typeof toolCall.name === 'string' && toolCall.name) return toolCall.name;
  let input = asRecord(toolCall.rawInput);
  if (!input && typeof toolCall.rawInput === 'string') {
    const trimmed = toolCall.rawInput.trim();
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      try {
        input = asRecord(JSON.parse(trimmed));
      } catch {
        // ignore
      }
    }
  }
  if (typeof input?.name === 'string' && input.name) return input.name;
  if (typeof toolCall.kind === 'string' && toolCall.kind) {
    return toolCall.kind;
  }
  if (typeof toolCall.title === 'string' && toolCall.title) {
    return toolCall.title;
  }
  return 'tool';
}
