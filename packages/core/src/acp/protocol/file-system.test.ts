import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from 'vite-plus/test';
import { handleFsReadTextFile, handleFsWriteTextFile } from './file-system.js';

test('requires absolute ACP paths and validates one-based line ranges', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'agentctl-acp-fs-'));
  try {
    const file = path.join(cwd, 'text');
    await fs.writeFile(file, 'one\ntwo\nthree');
    await expect(handleFsReadTextFile({ path: 'text' }, cwd)).rejects.toMatchObject({
      code: -32602,
    });
    await expect(
      handleFsWriteTextFile({ path: 'text', content: 'bad' }, cwd),
    ).rejects.toMatchObject({ code: -32602 });
    for (const line of [0, -1, 1.5])
      await expect(handleFsReadTextFile({ path: file, line }, cwd)).rejects.toMatchObject({
        code: -32602,
      });
    for (const limit of [-1, 1.5])
      await expect(handleFsReadTextFile({ path: file, limit }, cwd)).rejects.toMatchObject({
        code: -32602,
      });
    expect(await handleFsReadTextFile({ path: file, line: 2, limit: 1 }, cwd)).toEqual({
      content: 'two',
    });
    expect(await handleFsReadTextFile({ path: file, limit: 0 }, cwd)).toEqual({ content: '' });
    expect(await fs.readFile(file, 'utf8')).toBe('one\ntwo\nthree');
  } finally {
    await fs.rm(cwd, { recursive: true, force: true });
  }
});
