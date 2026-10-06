import { describe, expect, it } from 'vitest';
import { deriveAgentToolEffects } from './tool-effects.js';

describe('deriveAgentToolEffects', () => {
  it('projects reads without treating them as modifications', () => {
    expect(deriveAgentToolEffects({ kind: 'read', locations: [{ path: 'src/app.ts' }] })).toEqual([
      { type: 'file_read', path: 'src/app.ts' },
    ]);
  });

  it('preserves structured diff content', () => {
    expect(
      deriveAgentToolEffects({
        kind: 'edit',
        locations: [{ path: 'src/app.ts' }],
        content: [{ type: 'diff', path: 'src/app.ts', oldText: 'before', newText: 'after' }],
      }),
    ).toEqual([
      {
        type: 'file_modified',
        path: 'src/app.ts',
        oldText: 'before',
        newText: 'after',
      },
    ]);
  });
});

it('derives all file operations from structured diffs without needing a text patch', () => {
  expect(
    deriveAgentToolEffects({
      kind: 'edit',
      locations: [{ path: '/old.link' }, { path: '/unknown' }],
      content: [
        {
          type: 'diff',
          changes: [
            { operation: 'add', path: '/new.bin', fileType: 'binary' },
            { operation: 'delete', path: '/old.link', fileType: 'symlink' },
            { operation: 'move', oldPath: '/before', path: '/after', fileType: 'directory' },
            { operation: 'copy', oldPath: '/source', path: '/copy' },
            { operation: 'future_operation', path: '/unknown' },
          ],
        },
      ],
    }),
  ).toEqual([
    { type: 'file_modified', path: '/new.bin' },
    { type: 'file_deleted', path: '/old.link' },
    { type: 'file_deleted', path: '/before' },
    { type: 'file_modified', path: '/after' },
    { type: 'file_modified', path: '/copy' },
  ]);
});

it('preserves normalized statistics in product effects', () => {
  expect(
    deriveAgentToolEffects({
      content: [
        {
          type: 'diff',
          changes: [{ operation: 'modify', path: '/a' }],
          patch: { format: 'git_patch', text: '--- a/a\n+++ b/a\n@@ -1 +1 @@\n-old\n+new' },
        },
      ],
    }),
  ).toEqual([{ type: 'file_modified', path: '/a', stats: { additions: 1, deletions: 1 } }]);
});

it('combines statistics for the same file across separate structured content blocks', () => {
  const diff = {
    type: 'diff' as const,
    changes: [{ operation: 'modify', path: '/a' }],
    patch: { format: 'git_patch', text: '--- a/a\n+++ b/a\n@@ -1 +1 @@\n-old\n+new' },
  };
  expect(deriveAgentToolEffects({ content: [diff, diff] })).toEqual([
    { type: 'file_modified', path: '/a', stats: { additions: 2, deletions: 2 } },
  ]);
});
