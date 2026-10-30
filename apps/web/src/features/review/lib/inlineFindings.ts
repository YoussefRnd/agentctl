import type { CodeReviewRun } from '@agentctl/shared';
/** A cached 'current' label alone cannot place findings onto a different displayed comparison. */
export function currentInlineReview(
  runs: CodeReviewRun[],
  scope: 'working' | 'session',
  from: string | undefined,
  to: string | undefined,
) {
  if (!from || !to) return undefined;
  return runs.find(
    (run) =>
      run.status === 'completed' &&
      run.freshness === 'current' &&
      run.scope === scope &&
      run.fromRevision === from &&
      run.toRevision === to,
  );
}
