/** UTF-8 bytes are a deliberately conservative upper estimate of token cost. */
export function contextByteBudget(contextWindow?: number): number {
  const window =
    contextWindow && Number.isFinite(contextWindow) && contextWindow > 0 ? contextWindow : 32_000;
  // Reserve 60% for instructions, tools, the next prompt, and generated output.
  return Math.max(128, Math.min(32_768, Math.floor(window * 0.4)));
}

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

export function selectContextEntries<T extends ContextEntry>(
  entries: T[],
  budget: number,
  maxEntries = Infinity,
): T[] {
  const latestUser = entries.findLastIndex((entry) => entry.role === 'User');
  const latestAssistant = entries.findLastIndex((entry) => entry.role === 'Assistant');
  const originalUser = entries.findIndex((entry) => entry.role === 'User');
  const priority = [
    ...new Set([latestUser, latestAssistant, originalUser, ...entries.map((_, i) => i).reverse()]),
  ];
  const selected = new Set<number>();
  let remaining = Math.max(0, budget);
  for (const index of priority) {
    if (index < 0 || selected.size >= maxEntries) continue;
    const cost =
      Buffer.byteLength(JSON.stringify(`[${entries[index].role}]: ${entries[index].text}\n\n`)) +
      64;
    if (cost > remaining) continue;
    selected.add(index);
    remaining -= cost;
  }
  return entries.filter((_, index) => selected.has(index));
}
