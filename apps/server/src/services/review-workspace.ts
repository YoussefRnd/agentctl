import type { RepositoryCapture, ReviewDiffScope, ReviewFreshness } from '@agentctl/shared';
import { importSessionBaseline, type openSessionRepository } from './session-repository-service.js';

type SessionRepository = Awaited<ReturnType<typeof openSessionRepository>>;

export async function readReviewWorkspace({ session, repository }: SessionRepository) {
  const baseline = await importSessionBaseline(repository, session.baseCommit);
  return repository.review(baseline, { includeDiffs: false });
}

export function reviewRevisions(capture: RepositoryCapture, scope: ReviewDiffScope) {
  return {
    fromRevision: scope === 'session' ? capture.baseline : capture.working,
    toRevision: capture.current,
  };
}

export function reviewFreshness(
  review: ReturnType<typeof reviewRevisions> & { scope: ReviewDiffScope },
  capture?: RepositoryCapture,
): ReviewFreshness {
  if (!capture) return 'unknown';
  const { fromRevision, toRevision } = reviewRevisions(capture, review.scope);
  return review.fromRevision === fromRevision && review.toRevision === toRevision
    ? 'current'
    : 'outdated';
}
