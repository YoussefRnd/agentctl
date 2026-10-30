import { and, desc, eq, inArray } from 'drizzle-orm';
import { codeReviews, codeReviewFindings, type DbClient } from '@agentctl/core/db';
import { reviewFindingFingerprint } from '@agentctl/core';
import {
  capturedReviewFilesSchema,
  reviewFindingContinuitySchema,
  type ReviewFile,
  type ReviewPriorFinding,
  type ReviewContinuityReport,
} from '@agentctl/shared';
import type { ReviewVerificationService } from './review-verification-service.js';

export function savedReviewFiles(raw: string | null): ReviewFile[] | null {
  if (!raw) return null;
  try {
    return capturedReviewFilesSchema.parse(JSON.parse(raw));
  } catch {
    return null;
  }
}
export function savedFindingContinuity(raw: string | null) {
  if (!raw) return null;
  try {
    return reviewFindingContinuitySchema.parse(JSON.parse(raw));
  } catch {
    return null;
  }
}
/** Capture earlier decisions before starting a provider; never apply them as new resolutions. */
export function collectReviewHistory(
  db: DbClient,
  sessionId: string,
  scope: 'working' | 'session',
  files: ReviewFile[],
  from: string,
  to: string,
  budget: number,
  verification?: Pick<ReviewVerificationService, 'states'>,
) {
  const runs = db
    .select()
    .from(codeReviews)
    .where(
      and(
        eq(codeReviews.sessionId, sessionId),
        eq(codeReviews.scope, scope),
        eq(codeReviews.status, 'completed'),
      ),
    )
    .orderBy(desc(codeReviews.startedAt), desc(codeReviews.id))
    .limit(11)
    .all();
  const selected = runs.slice(0, 10);
  const report: ReviewContinuityReport = {
    provided: 0,
    omitted: 0,
    historyLimited: runs.length > 10,
    findingIds: [],
  };
  if (!selected.length) return { history: [] as ReviewPriorFinding[], report };
  const findings = db
    .select()
    .from(codeReviewFindings)
    .where(
      inArray(
        codeReviewFindings.reviewId,
        selected.map((run) => run.id),
      ),
    )
    .all();
  const states = verification?.states(selected.map((run) => run.id));
  const paths = new Set(files.map((file) => file.path));
  const history: ReviewPriorFinding[] = [];
  const seen = new Map<string, string>();
  for (const run of selected) {
    const sources = savedReviewFiles(run.capturedFiles);
    const prepared = findings
      .filter((finding) => finding.reviewId === run.id && paths.has(finding.path))
      .map((finding) => ({
        finding,
        fingerprint:
          finding.fingerprint ??
          reviewFindingFingerprint(
            finding,
            sources?.find((file) => file.path === finding.path),
          ),
      }));
    const counts = new Map<string, number>();
    for (const { fingerprint } of prepared)
      if (fingerprint) counts.set(fingerprint, (counts.get(fingerprint) ?? 0) + 1);
    for (const { finding, fingerprint } of prepared) {
      const identity =
        fingerprint ?? `${finding.path}\0${finding.title.trim().toLowerCase()}\0${finding.line}`;
      if (seen.has(identity) && seen.get(identity) !== run.id) continue;
      seen.set(identity, run.id);
      const prior = savedFindingContinuity(finding.continuity);
      const lastDecision =
        finding.status !== 'open'
          ? {
              reviewId: run.id,
              findingId: finding.id,
              status: finding.status,
              resolution: finding.resolution,
            }
          : (prior?.lastDecision ?? null);
      const verification = states?.findings.get(finding.id) ?? {
        state: 'suspected' as const,
        checkId: null,
        reason: null,
        confirmedAt: null,
      };
      const lastEvidence =
        verification.confirmedAt !== null
          ? { reviewId: run.id, findingId: finding.id, verification }
          : (prior?.lastEvidence ?? null);
      const entry: ReviewPriorFinding = {
        reviewId: run.id,
        findingId: finding.id,
        path: finding.path,
        line: finding.line,
        title: finding.title,
        body: finding.body,
        status: finding.status,
        resolution: finding.resolution,
        verification,
        lastEvidence,
        comparison: run.fromRevision === from && run.toRevision === to ? 'same' : 'changed',
        fingerprint: fingerprint && counts.get(fingerprint)! > 1 ? null : fingerprint,
        lastDecision,
      };
      if (history.length >= 20 || JSON.stringify([...history, entry]).length > budget) {
        report.omitted++;
        continue;
      }
      history.push(entry);
    }
  }
  report.provided = history.length;
  report.findingIds = history.map((entry) => entry.findingId);
  return { history, report };
}
