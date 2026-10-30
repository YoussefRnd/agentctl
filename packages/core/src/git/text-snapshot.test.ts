import { afterEach, beforeEach, expect, it } from 'vite-plus/test';
import { mkdtemp, writeFile, mkdir, rm, symlink } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
import path from 'node:path';
import { SnapshotService } from './snapshot-service.js';
import { createDefaultRepositoryService } from '../default-repository-service.js';
const exec = promisify(execFile);
let cwd: string;
let storage: string;
const git = async (...args: string[]) => (await exec('git', args, { cwd })).stdout.trim();
beforeEach(async () => {
  cwd = await mkdtemp(path.join(os.tmpdir(), 'text-snapshot-'));
  storage = await mkdtemp(path.join(os.tmpdir(), 'text-snapshot-storage-'));
  await git('init', '-b', 'main');
  await git('config', 'user.name', 'Test');
  await git('config', 'user.email', 'test@example.com');
});
afterEach(async () => {
  await rm(cwd, { recursive: true, force: true });
  await rm(storage, { recursive: true, force: true });
});
async function snapshot(subdir = '') {
  const repository = await createDefaultRepositoryService(new SnapshotService(storage)).open(
    path.join(cwd, subdir),
  );
  return { repository, reader: (await repository.textSnapshot(await repository.capture()))! };
}
it('reads captured contents, untracked files and literal paths after live files change', async () => {
  await git('config', 'color.grep', 'always');
  await writeFile(path.join(cwd, 'source.ts'), 'export const changedName = 1;\n');
  await writeFile(path.join(cwd, 'bracket[1].ts'), 'literal');
  const { reader } = await snapshot();
  await writeFile(path.join(cwd, 'source.ts'), 'LIVE_MUTATION');
  expect(await reader.readFile('source.ts', 1000)).toEqual({
    status: 'text',
    text: 'export const changedName = 1;\n',
  });
  expect(await reader.readFile('bracket[1].ts', 1000)).toEqual({ status: 'text', text: 'literal' });
  expect(await reader.search?.(['changedName'], 10)).toEqual({
    paths: ['source.ts'],
    truncated: false,
  });
  expect(await reader.search?.(['nonexistent_symbol'], 10)).toEqual({
    paths: [],
    truncated: false,
  });
});
it('never follows symlinks and reports binary, missing and oversized files explicitly', async () => {
  await writeFile(path.join(storage, 'private.txt'), 'PRIVATE_CONTENT');
  await symlink(path.join(storage, 'private.txt'), path.join(cwd, 'linked.ts'));
  await writeFile(path.join(cwd, 'binary.dat'), Buffer.from([0, 1, 2]));
  await writeFile(path.join(cwd, 'large.ts'), 'x'.repeat(200));
  const { reader } = await snapshot();
  expect(await reader.readFile('linked.ts', 1000)).toEqual({ status: 'symlink' });
  expect(await reader.readFile('binary.dat', 1000)).toEqual({ status: 'binary' });
  expect(await reader.readFile('large.ts', 100)).toEqual({ status: 'too_large' });
  expect(await reader.readFile('missing.ts', 100)).toEqual({ status: 'missing' });
  await expect(reader.readFile('../private.txt', 1000)).rejects.toThrow('workspace-relative');
  const listing = await reader.listFiles(1);
  expect(listing.files).toHaveLength(1);
  expect(listing.truncated).toBe(true);
});
it('keeps subdirectory snapshots scoped and cannot read sibling project files', async () => {
  await mkdir(path.join(cwd, 'app'));
  await writeFile(path.join(cwd, 'app', 'source.ts'), 'const scopedSymbol = 1;');
  await writeFile(path.join(cwd, 'outside.ts'), 'const scopedSymbol = 2;');
  const { reader } = await snapshot('app');
  expect((await reader.listFiles(100)).files.map((file) => file.path)).toEqual(['source.ts']);
  expect(await reader.readFile('outside.ts', 1000)).toEqual({ status: 'missing' });
  expect(await reader.search?.(['scopedSymbol'], 10)).toEqual({
    paths: ['source.ts'],
    truncated: false,
  });
});
it('aborts context reads and marks bounded searches truncated', async () => {
  await writeFile(path.join(cwd, 'a.ts'), 'const matchingSymbol = 1;');
  await writeFile(path.join(cwd, 'b.ts'), 'const matchingSymbol = 2;');
  const { reader } = await snapshot();
  expect(await reader.search?.(['matchingSymbol'], 1)).toMatchObject({
    paths: ['a.ts'],
    truncated: true,
  });
  const controller = new AbortController();
  controller.abort();
  await expect(reader.readFile('a.ts', 1000, controller.signal)).rejects.toThrow();
});
