/** Compact token counts consistently across context, activity, and agent views. */
export function formatTokenCount(count: number): string {
  const safe = Number.isFinite(count) ? Math.max(0, count) : 0;
  if (safe >= 999_950) return `${Number((safe / 1_000_000).toFixed(1))}M`;
  if (safe >= 1_000) return `${(safe / 1_000).toFixed(1)}K`;
  return String(safe);
}
