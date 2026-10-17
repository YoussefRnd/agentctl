import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { resolveAllowedPath } from '../../security/path-security.js';

describe('resolveAllowedPath', () => {
  let root: string;
  let outside: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentctl-path-root-'));
    outside = fs.mkdtempSync(path.join(os.tmpdir(), 'agentctl-path-outside-'));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  });

  test('allows a new file under the workspace', () => {
    expect(resolveAllowedPath('nested/file.txt', root, [], true)).toBe(
      path.join(root, 'nested', 'file.txt'),
    );
  });

  test('rejects a new file whose existing parent symlink escapes the workspace', () => {
    fs.symlinkSync(outside, path.join(root, 'escape'), 'dir');

    expect(() => resolveAllowedPath('escape/new-file.txt', root, [], true)).toThrow(
      'outside allowed roots',
    );
  });
});
