import { expect, test } from 'vite-plus/test';
import { normalizeFileChanges } from './file-changes.js';

test('assigns hunk counts to their files and splits a move between its source and destination', () => {
  const changes = [
    { operation: 'modify', path: '/workspace/a.ts' },
    { operation: 'add', path: '/workspace/b.ts' },
    { operation: 'delete', path: '/workspace/c.ts' },
    { operation: 'move', oldPath: '/workspace/old.ts', path: '/workspace/new.ts' },
  ];
  const text = [
    'diff --git a/a.ts b/a.ts',
    '--- a/a.ts',
    '+++ b/a.ts',
    '@@ -1,2 +1,2 @@',
    '-old',
    '+new',
    ' unchanged',
    'diff --git a/b.ts b/b.ts',
    '--- /dev/null',
    '+++ b/b.ts',
    '@@ -0,0 +1,2 @@',
    '+one',
    '+two',
    'diff --git a/c.ts b/c.ts',
    '--- a/c.ts',
    '+++ /dev/null',
    '@@ -1,1 +0,0 @@',
    '-gone',
    'diff --git a/old.ts b/new.ts',
    'rename from old.ts',
    'rename to new.ts',
    '--- a/old.ts',
    '+++ b/new.ts',
    '@@ -1 +1 @@',
    '-old',
    '+new',
  ].join('\n');
  expect(normalizeFileChanges({ changes, patch: { format: 'git_patch', text } })).toEqual([
    { operation: 'modify', path: '/workspace/a.ts', stats: { additions: 1, deletions: 1 } },
    { operation: 'add', path: '/workspace/b.ts', stats: { additions: 2, deletions: 0 } },
    { operation: 'delete', path: '/workspace/c.ts', stats: { additions: 0, deletions: 1 } },
    { operation: 'delete', path: '/workspace/old.ts', stats: { additions: 0, deletions: 1 } },
    { operation: 'add', path: '/workspace/new.ts', stats: { additions: 1, deletions: 0 } },
  ]);
});

test('handles quoted paths and octal UTF-8 without counting patch headers as changed lines', () => {
  const text =
    'diff --git "a/sp ace-\\303\\251.ts" "b/sp ace-\\303\\251.ts"\n--- "a/sp ace-\\303\\251.ts"\n+++ "b/sp ace-\\303\\251.ts"\n@@ -1 +1,2 @@\n---text beginning with dashes\n+++text beginning with pluses\n+other\n\\ No newline at end of file';
  expect(
    normalizeFileChanges({
      changes: [{ operation: 'modify', path: '/workspace/sp ace-é.ts' }],
      patch: { format: 'git_patch', text },
    })[0].stats,
  ).toEqual({ additions: 2, deletions: 1 });
});

test('keeps unknown operations and absent patches from inventing file modifications or statistics', () => {
  const changes = [
    { operation: 'copy', oldPath: '/source', path: '/destination', fileType: 'binary' },
    { operation: 'future_operation', path: '/unknown' },
  ];
  expect(normalizeFileChanges({ changes, patch: null })).toEqual([
    { operation: 'add', path: '/destination' },
  ]);
  expect(
    normalizeFileChanges({ changes, patch: { format: 'future_patch', text: 'anything' } }),
  ).toEqual([{ operation: 'add', path: '/destination' }]);
});

test('does not infer file operations from extra patch sections or ambiguous paths', () => {
  const text = [
    '--- one/file',
    '+++ one/file',
    '@@ -1 +1 @@',
    '-one',
    '+new',
    '--- two/file',
    '+++ two/file',
    '@@ -1 +1,2 @@',
    '-two',
    '+new',
    '+second',
  ].join('\n');
  expect(
    normalizeFileChanges({
      changes: [{ operation: 'modify', path: '/file' }],
      patch: { format: 'git_patch', text },
    }),
  ).toEqual([{ operation: 'modify', path: '/file' }]);
  expect(
    normalizeFileChanges({
      changes: [{ operation: 'modify', path: '/workspace/two/file' }],
      patch: { format: 'git_patch', text },
    })[0].stats,
  ).toEqual({ additions: 2, deletions: 1 });
});

test('separates consecutive deletion sections without diff preambles', () => {
  const text =
    '--- first\n+++ /dev/null\n@@ -1 +0,0 @@\n-gone\n--- second\n+++ /dev/null\n@@ -1,2 +0,0 @@\n-one\n-two';
  const result = normalizeFileChanges({
    changes: [
      { operation: 'delete', path: '/first' },
      { operation: 'delete', path: '/second' },
    ],
    patch: { format: 'git_patch', text },
  });
  expect(result.map((change) => change.stats?.deletions)).toEqual([1, 2]);
});

test('does not assign statistics using malformed quoted paths', () => {
  for (const path of ['"b/file', '"b/file\\', '"b/\\777file"']) {
    expect(
      normalizeFileChanges({
        changes: [{ operation: 'modify', path: '/file' }],
        patch: { format: 'git_patch', text: `--- a/file\n+++ ${path}\n@@ -1 +1 @@\n-old\n+new` },
      }),
    ).toEqual([{ operation: 'modify', path: '/file' }]);
  }
});

test('counts a large patch with mixed line endings and no trailing newline', () => {
  const hunks = Array.from({ length: 600 }, (_, index) =>
    ['@@ -1,2 +1,3 @@', '-old', ' context', '+new', '+extra'].join(index % 2 ? '\r\n' : '\n'),
  );
  expect(
    normalizeFileChanges({
      changes: [{ operation: 'modify', path: '/workspace/file' }],
      patch: { format: 'git_patch', text: ['--- a/file', '+++ b/file', ...hunks].join('\n') },
    }),
  ).toEqual([
    { operation: 'modify', path: '/workspace/file', stats: { additions: 1200, deletions: 600 } },
  ]);
});

test('resets incomplete hunks at file boundaries and ignores metadata outside hunks', () => {
  expect(
    normalizeFileChanges({
      changes: [
        { operation: 'modify', path: '/first' },
        { operation: 'add', path: '/second' },
      ],
      patch: {
        format: 'git_patch',
        text: [
          'diff --git a/first b/first',
          '--- a/first',
          '+++ b/first',
          '@@ -1,10 +1,10 @@',
          '-old',
          '+new',
          'diff --git a/second b/second',
          '--- /dev/null',
          '+++ b/second',
          '+metadata is not a hunk',
          '@@ malformed @@',
          '+ignored',
          '@@ -0,0 +1 @@',
          '+added',
          '\\ No newline at end of file',
        ].join('\r\n'),
      },
    }),
  ).toEqual([
    { operation: 'modify', path: '/first', stats: { additions: 1, deletions: 1 } },
    { operation: 'add', path: '/second', stats: { additions: 1, deletions: 0 } },
  ]);
});
