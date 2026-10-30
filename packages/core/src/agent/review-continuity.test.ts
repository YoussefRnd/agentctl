import { expect, it } from 'vite-plus/test';
import type { ReviewFile, ReviewPriorFinding } from '@agentctl/shared';
import { reviewFindingFingerprint, matchReviewFinding } from './review-continuity.js';
const finding = { path: 'src/input.ts', line: 2, title: 'Missing input guard' };
const file: ReviewFile = {
  path: finding.path,
  state: 'modified',
  diff: '@@ -1,3 +1,3 @@\n export function input(value) {\n-  return value;\n+  return value.trim();\n }',
};
const prior: ReviewPriorFinding = {
  reviewId: '11111111-1111-4111-8111-111111111111',
  findingId: '22222222-2222-4222-8222-222222222222',
  ...finding,
  body: 'Empty input throws.',
  status: 'dismissed',
  resolution: 'Caller guarantees a string.',
  verification: { state: 'suspected', checkId: null, reason: null, confirmedAt: null },
  comparison: 'changed',
  fingerprint: reviewFindingFingerprint(finding, file),
  lastDecision: null,
  lastEvidence: null,
};
it('matches unchanged source after line shifts, without treating changed source as identical', () => {
  const shifted = { ...file, diff: file.diff.replace('@@ -1,3 +1,3 @@', '@@ -21,3 +21,3 @@') };
  const fingerprint = reviewFindingFingerprint({ ...finding, line: 22 }, shifted);
  expect(fingerprint).toBe(prior.fingerprint);
  expect(matchReviewFinding({ ...finding, line: 22 }, fingerprint, [prior])).toMatchObject({
    findingId: prior.findingId,
    match: 'fingerprint',
    status: 'dismissed',
    comparison: 'changed',
  });
  const changed = reviewFindingFingerprint(finding, {
    ...file,
    diff: file.diff.replace('value.trim()', 'value.trim().length'),
  });
  expect(changed).not.toBe(fingerprint);
  expect(matchReviewFinding(finding, changed, [prior])).toBeNull();
});
it('accepts optional reviewer references only to supplied history on the same path, and never invents a resolution', () => {
  expect(
    matchReviewFinding({ ...finding, previousFindingId: prior.findingId }, 'changed-code', [prior]),
  ).toMatchObject({ match: 'reviewer', status: 'dismissed' });
  expect(
    matchReviewFinding({ ...finding, path: 'other.ts', previousFindingId: prior.findingId }, null, [
      prior,
    ]),
  ).toBeNull();
  expect(
    matchReviewFinding(
      { ...finding, previousFindingId: '33333333-3333-4333-8333-333333333333' },
      null,
      [prior],
    ),
  ).toBeNull();
  expect(
    matchReviewFinding(finding, prior.fingerprint, [
      prior,
      { ...prior, findingId: '44444444-4444-4444-8444-444444444444' },
    ]),
  ).toBeNull();
});
it('anchors deleted-file findings to old-side lines and refuses absent/blank source', () => {
  const deleted: ReviewFile = {
    path: finding.path,
    state: 'deleted',
    diff: '@@ -1,2 +0,0 @@\n-export const input = value.trim();\n-// removed',
  };
  expect(reviewFindingFingerprint({ ...finding, line: 1 }, deleted)).toBeTypeOf('string');
  expect(reviewFindingFingerprint({ ...finding, line: 3 }, deleted)).toBeNull();
  expect(reviewFindingFingerprint(finding, undefined)).toBeNull();
  expect(
    reviewFindingFingerprint(finding, {
      ...file,
      diff: file.diff.replace('  return value.trim();', ''),
    }),
  ).toBeNull();
});
