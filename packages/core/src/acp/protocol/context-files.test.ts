import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, test, vi } from 'vite-plus/test';
import {
  persistContextDocument,
  removeSessionContextFiles,
  registerContextFile,
} from '../../session/context-files.js';
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

test('saved handoff history survives expiry and a fresh module instance while remaining session-scoped', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'agentctl-durable-context-'));
  vi.stubEnv('AGENTCTL_HOME', path.join(directory, 'state'));
  const cwd = path.join(directory, 'project');
  await fs.mkdir(cwd);
  try {
    const content = 'Original request\n'.repeat(50) + 'Latest reply';
    const filePath = await persistContextDocument('owner', content);
    expect(await persistContextDocument('owner', content)).toBe(filePath);
    expect((await fs.stat(filePath)).mode & 0o777).toBe(0o600);
    vi.useFakeTimers();
    vi.advanceTimersByTime(24 * 60 * 60_000);
    vi.resetModules();
    const { handleFsReadTextFile: reloadedRead } = await import('./file-system.js');
    expect(await reloadedRead({ path: filePath, line: 51, limit: 1 }, cwd, [], 'owner')).toEqual({
      content: 'Latest reply',
    });
    await expect(reloadedRead({ path: filePath }, cwd, [], 'other')).rejects.toThrow(
      'outside allowed roots',
    );
    await expect(
      handleFsWriteTextFile({ path: filePath, content: 'overwrite' }, cwd),
    ).rejects.toThrow('outside allowed roots');
    await removeSessionContextFiles('owner');
    await expect(reloadedRead({ path: filePath }, cwd, [], 'owner')).rejects.toThrow();
  } finally {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('durable context rejects symlink replacements and path traversal', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'agentctl-context-links-'));
  vi.stubEnv('AGENTCTL_HOME', path.join(directory, 'state'));
  const cwd = path.join(directory, 'project');
  await fs.mkdir(cwd);
  try {
    await expect(persistContextDocument('../other', 'bad')).rejects.toThrow(
      'Invalid context session ID',
    );
    const ownerPath = await persistContextDocument('owner', 'Saved context');
    const otherPath = await persistContextDocument('other', 'Saved context');
    await fs.unlink(ownerPath);
    await fs.symlink(otherPath, ownerPath);
    await expect(handleFsReadTextFile({ path: ownerPath }, cwd, [], 'owner')).rejects.toThrow(
      'outside allowed roots',
    );
    await fs.rm(path.dirname(ownerPath), { recursive: true, force: true });
    await fs.symlink(path.dirname(otherPath), path.dirname(ownerPath), 'dir');
    await expect(handleFsReadTextFile({ path: ownerPath }, cwd, [], 'owner')).rejects.toThrow(
      'outside allowed roots',
    );
    await expect(persistContextDocument('owner', 'New context')).rejects.toThrow(
      'Invalid context directory',
    );
  } finally {
    vi.unstubAllEnvs();
    await fs.rm(directory, { recursive: true, force: true });
  }
});
