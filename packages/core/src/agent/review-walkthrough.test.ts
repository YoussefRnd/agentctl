import { expect, it } from 'vite-plus/test';
import { normalizeReviewWalkthrough } from './review-walkthrough.js';
const files = [
  { path: 'input.ts', state: 'modified' as const, diff: '@@ -1 +1 @@\n-old\n+new' },
  { path: 'test.ts', state: 'untracked' as const, diff: '@@ -0,0 +1 @@\n+test' },
];
const stop = {
  title: 'Input validation changes',
  summary: 'The input path adds a guard.',
  excerpts: [{ path: 'input.ts', side: 'new' as const, line: 1 }],
  files: [],
};
it('validates captured locations and accounts for files omitted by generated explanations', () => {
  const result = normalizeReviewWalkthrough([stop], files)!;
  expect(result[1]).toMatchObject({ title: 'Other changed files', files: ['test.ts'] });
  expect(() =>
    normalizeReviewWalkthrough(
      [{ ...stop, excerpts: [{ path: 'secret.ts', side: 'new', line: 1 }] }],
      files,
    ),
  ).toThrow();
  expect(() =>
    normalizeReviewWalkthrough(
      [{ ...stop, excerpts: [{ path: 'input.ts', side: 'new', line: 99 }] }],
      files,
    ),
  ).toThrow();
  expect(normalizeReviewWalkthrough(undefined, files)).toBeUndefined();
});
it('requires old-side excerpts for deleted source', () => {
  const deleted = [{ ...files[0], state: 'deleted' as const, diff: '@@ -1 +0,0 @@\n-old' }];
  expect(() => normalizeReviewWalkthrough([stop], deleted)).toThrow();
  expect(
    normalizeReviewWalkthrough(
      [{ ...stop, excerpts: [{ path: 'input.ts', side: 'old', line: 1 }] }],
      deleted,
    ),
  ).toHaveLength(1);
});
