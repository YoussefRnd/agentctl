export function attachmentContextAllowance(mimeTypes: string[]): number {
  return mimeTypes.reduce((sum, mime) => sum + (mime.startsWith('image/') ? 8_192 : 4_096), 0);
}

export function providerContextByteBudget(input: {
  contextWindow?: number;
  usedTokens?: number | null;
  userText: string;
  instructions: string;
  attachmentMimeTypes: string[];
}): number {
  const window = input.contextWindow && input.contextWindow > 0 ? input.contextWindow : 128_000;
  const attachments = attachmentContextAllowance(input.attachmentMimeTypes);
  return Math.max(
    0,
    Math.min(
      16_000,
      window -
        (input.usedTokens ?? 0) -
        attachments -
        Buffer.byteLength(JSON.stringify(input.userText)) -
        Buffer.byteLength(JSON.stringify(input.instructions)) -
        Math.max(16_000, Math.ceil(window / 4)),
    ),
  );
}

export interface ContextEntry {
  role: string;
  text: string;
  eventId?: number;
}

export function selectContextEntries<T extends ContextEntry>(entries: T[], budget: number): T[] {
  const latestUser = entries.findLastIndex((entry) => entry.role === 'User');
  const latestAssistant = entries.findLastIndex((entry) => entry.role === 'Assistant');
  const originalUser = entries.findIndex((entry) => entry.role === 'User');
  const priority = [
    ...new Set([latestUser, latestAssistant, originalUser, ...entries.map((_, i) => i).reverse()]),
  ];
  const selected = new Set<number>();
  let remaining = Math.max(0, budget);
  for (const index of priority) {
    if (index < 0) continue;
    const cost =
      Buffer.byteLength(JSON.stringify(`[${entries[index].role}]: ${entries[index].text}\n\n`)) +
      64;
    if (cost > remaining) continue;
    selected.add(index);
    remaining -= cost;
  }
  return entries.filter((_, index) => selected.has(index));
}
