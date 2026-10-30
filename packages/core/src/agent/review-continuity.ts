import { createHash } from 'node:crypto';
import type { ReviewFile, ReviewPriorFinding, ReviewFindingContinuity } from '@agentctl/shared';

type Finding = { path: string; line: number; title: string; previousFindingId?: string };
/** Location-independent source identity; absent source must never look like a confirmed match. */
export function reviewFindingFingerprint(
  finding: Finding,
  file: ReviewFile | undefined,
): string | null {
  if (!file) return null;
  const side = file.state === 'deleted' ? 'old' : 'new';
  let old = 0;
  let current = 0;
  const rows: { number: number; text: string }[] = [];
  for (const line of file.diff.split('\n')) {
    const header = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (header) {
      old = Number(header[1]);
      current = Number(header[2]);
      continue;
    }
    if (!old && !current) continue;
    if (line.startsWith(' ')) {
      rows.push({ number: side === 'old' ? old : current, text: line.slice(1) });
      old++;
      current++;
    } else if (line.startsWith('-')) {
      if (side === 'old') rows.push({ number: old, text: line.slice(1) });
      old++;
    } else if (line.startsWith('+')) {
      if (side === 'new') rows.push({ number: current, text: line.slice(1) });
      current++;
    }
  }
  const index = rows.findIndex((row) => row.number === finding.line);
  if (index < 0 || !rows[index].text.trim()) return null;
  const anchor = rows
    .slice(Math.max(0, index - 2), index + 3)
    .filter((row) => Math.abs(row.number - finding.line) <= 2)
    .map((row) => [row.number - finding.line, row.text]);
  return createHash('sha256')
    .update(
      JSON.stringify([
        finding.path,
        side,
        finding.title.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' '),
        anchor,
      ]),
    )
    .digest('hex');
}
export function matchReviewFinding(
  finding: Finding,
  fingerprint: string | null,
  history: ReviewPriorFinding[],
): ReviewFindingContinuity | null {
  const exact = fingerprint
    ? history.filter((prior) => prior.path === finding.path && prior.fingerprint === fingerprint)
    : [];
  const prior =
    exact.length === 1
      ? exact[0]
      : history.find(
          (prior) => prior.findingId === finding.previousFindingId && prior.path === finding.path,
        );
  if (!prior) return null;
  return {
    reviewId: prior.reviewId,
    findingId: prior.findingId,
    status: prior.status,
    resolution: prior.resolution,
    verification: prior.verification,
    comparison: prior.comparison,
    match: exact.length === 1 ? 'fingerprint' : 'reviewer',
    lastDecision: prior.lastDecision,
    lastEvidence: prior.lastEvidence,
  };
}
