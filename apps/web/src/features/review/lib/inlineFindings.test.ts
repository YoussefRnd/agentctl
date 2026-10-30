import { expect, it } from 'vite-plus/test';
import type { CodeReviewRun } from '@agentctl/shared';
import { currentInlineReview } from './inlineFindings';
it('places annotations only on a completed review of the exact displayed scope and both revisions', () => {
  const run = {
    id: 'saved',
    status: 'completed',
    freshness: 'current',
    scope: 'working',
    fromRevision: 'base',
    toRevision: 'current',
  } as CodeReviewRun;
  expect(currentInlineReview([run], 'working', 'base', 'current')).toBe(run);
  for (const changed of [
    { status: 'running' },
    { freshness: 'outdated' },
    { freshness: 'unknown' },
    { scope: 'session' },
    { fromRevision: 'old-base' },
    { toRevision: 'old-code' },
  ])
    expect(
      currentInlineReview([{ ...run, ...changed } as CodeReviewRun], 'working', 'base', 'current'),
    ).toBeUndefined();
  expect(currentInlineReview([run], 'working', undefined, 'current')).toBeUndefined();
});
