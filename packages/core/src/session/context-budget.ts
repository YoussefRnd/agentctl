/** UTF-8 bytes are a deliberately conservative upper estimate of token cost. */
export function contextByteBudget(contextWindow?: number): number {
  const window =
    contextWindow && Number.isFinite(contextWindow) && contextWindow > 0 ? contextWindow : 32_000;
  // Reserve 60% for instructions, tools, the next prompt, and generated output.
  return Math.max(128, Math.min(32_768, Math.floor(window * 0.4)));
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
      Buffer.byteLength(`[${entries[index].role}]: ${entries[index].text}\n\n`, 'utf8') + 16;
    if (cost > remaining) continue;
    selected.add(index);
    remaining -= cost;
  }
  return entries.filter((_, index) => selected.has(index));
}
