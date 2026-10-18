import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, test, vi } from 'vite-plus/test';
import { registerContextFile } from '../../session/context-files.js';
import { handleFsReadTextFile, handleFsWriteTextFile } from './file-system.js';

test('handoff documents are readable only by their session and never expand write access', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'agentctl-context-grant-'));
  const filePath = path.join(directory, 'history.md');
  await fs.writeFile(filePath, 'Original request\nLatest reply');
  const cwd = path.join(directory, 'project');
  await fs.mkdir(cwd);
  registerContextFile('owner', filePath);
  try {
    expect(
      await handleFsReadTextFile({ path: filePath, line: 2, limit: 1 }, cwd, [], 'owner'),
    ).toEqual({ content: 'Latest reply' });
    await expect(handleFsReadTextFile({ path: filePath }, cwd, [], 'other')).rejects.toThrow(
      'outside allowed roots',
    );
    await expect(
      handleFsWriteTextFile({ path: filePath, content: 'overwrite' }, cwd),
    ).rejects.toThrow('outside allowed roots');
    vi.useFakeTimers();
    vi.advanceTimersByTime(11 * 60_000);
    await expect(handleFsReadTextFile({ path: filePath }, cwd, [], 'owner')).rejects.toThrow(
      'outside allowed roots',
    );
  } finally {
    vi.useRealTimers();
    await fs.rm(directory, { recursive: true, force: true });
  }
});
