/** Case-insensitive subsequence matching with prefix, boundary, and consecutive-match bonuses. */
export function fuzzyScore(target: string, query: string): number {
  if (!query) return 100;
  const t = target.toLowerCase();
  const q = query.toLowerCase();

  let tIdx = 0;
  let qIdx = 0;
  let score = 0;
  let consecutive = 0;

  while (tIdx < t.length && qIdx < q.length) {
    if (t[tIdx] === q[qIdx]) {
      score += 10;
      if (consecutive > 0) score += consecutive * 15;
      consecutive++;

      if (tIdx === 0 || '/-_ .:'.includes(t[tIdx - 1])) {
        score += 35;
      }
      qIdx++;
    } else {
      consecutive = 0;
    }
    tIdx++;
  }

  if (qIdx < q.length) return -1;

  if (t === q) score += 200;
  else if (t.startsWith(q)) score += 80;

  score -= (t.length - q.length) * 0.4;
  return Math.max(1, score);
}

/** Rank matches across fields; preserve original order for empty queries and tied scores. */
export function fuzzySearch<T>(
  items: readonly T[],
  query: string,
  fields: (item: T) => readonly (string | undefined)[],
  limit = items.length,
): T[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return items.slice(0, limit);
  const scored: Array<{ item: T; score: number }> = [];
  for (const item of items) {
    let score = -1;
    for (const field of fields(item)) {
      if (field) score = Math.max(score, fuzzyScore(field, normalizedQuery));
    }
    if (score > 0) scored.push({ item, score });
  }
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ item }) => item);
}
