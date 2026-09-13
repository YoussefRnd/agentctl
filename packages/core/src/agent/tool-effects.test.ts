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
