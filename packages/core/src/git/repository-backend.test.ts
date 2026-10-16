import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { RepositoryService } from '../repository/repository-service.js';
import { DirectoryBackend } from '../repository/directory-backend.js';
import { GitRepositoryBackend } from './repository-backend.js';
import { SnapshotService } from './snapshot-service.js';

let directory: string;
let service: RepositoryService;
const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

async function initRepository(root: string) {
  await fs.mkdir(path.join(root, 'pkg'), { recursive: true });
  git(root, 'init', '-b', 'main');
  git(root, 'config', 'user.name', 'Test');
  git(root, 'config', 'user.email', 'test@example.com');
  await fs.writeFile(path.join(root, 'pkg', 'file.txt'), 'before\n');
  git(root, 'add', '.');
  git(root, '-c', 'commit.gpgSign=false', 'commit', '-m', 'baseline');
}

beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'repository-service-'));
  service = new RepositoryService([
    new GitRepositoryBackend(new SnapshotService(path.join(directory, 'snapshots'))),
    new DirectoryBackend(),
  ]);
});

afterEach(async () => {
  await fs.rm(directory, { recursive: true, force: true });
});

it('reviews and restores captured Git revisions without exposing Git IDs to callers', async () => {
  const root = path.join(directory, 'repo');
  await initRepository(root);
  const workspace = path.join(root, 'pkg');
  const repository = await service.open(workspace);
  const baseline = await repository.resolveRevision('HEAD');
  await fs.writeFile(path.join(workspace, 'file.txt'), 'captured\n');
  git(root, 'add', '.');
  const indexBefore = await fs.readFile(path.join(root, '.git', 'index'));
  const summary = await repository.review(baseline, { includeDiffs: false, scope: 'working' });
  expect(summary.repository?.capabilities).toEqual({
    review: true,
    checkpoints: true,
    comparisons: true,
    restore: true,
  });
  expect(summary.capture?.current).not.toMatch(/^[0-9a-f]+$/i);
  expect(summary.files[0]).toMatchObject({ path: 'file.txt', state: 'staged', diff: '' });
  await fs.writeFile(path.join(workspace, 'file.txt'), 'later\nextra\n');
  const reopened = await service.open(workspace);
  const [detail] = await reopened.diff(
    summary.capture!.working,
    summary.capture!.current,
    'file.txt',
  );
  expect(detail.diff).toContain('+captured');
  expect(detail.diff).not.toContain('later');
  expect((await reopened.compare(baseline, summary.capture!.current)).totalAdditions).toBe(1);
  const restore = await reopened.restore(baseline);
  expect(await fs.readFile(path.join(workspace, 'file.txt'), 'utf8')).toBe('before\n');
  await reopened.restore(restore.backup);
  expect(await fs.readFile(path.join(workspace, 'file.txt'), 'utf8')).toBe('later\nextra\n');
  expect(await fs.readFile(path.join(root, '.git', 'index'))).toEqual(indexBefore);
});

it('shares repository identity across linked worktrees, preserves scope, and canonicalizes aliases', async () => {
  const root = path.join(directory, 'repo');
  const linked = path.join(directory, 'linked');
  await initRepository(root);
  git(root, 'worktree', 'add', '-b', 'feature', linked);
  const alias = path.join(directory, 'alias');
  await fs.symlink(path.join(linked, 'pkg'), alias);
  const first = await service.open(path.join(root, 'pkg'));
  const second = await service.open(alias);
  expect(first.info.repositoryId).toBe(second.info.repositoryId);
  expect(first.info.workspaceId).not.toBe(second.info.workspaceId);
  expect(second.info.scope).toBe('pkg');
  expect(second.info.workspacePath).toBe(await fs.realpath(alias));
  const baseline = await first.capture();
  const current = await second.capture();
  expect(await second.compare(baseline, current)).toEqual({
    files: [],
    totalAdditions: 0,
    totalDeletions: 0,
  });
  const repositoryRoot = await service.open(root);
  await expect(repositoryRoot.diff(baseline, current)).rejects.toMatchObject({
    code: 'invalid_revision',
  });
  const otherRoot = path.join(directory, 'other');
  await initRepository(otherRoot);
  const other = await service.open(path.join(otherRoot, 'pkg'));
  await expect(other.restore(baseline)).rejects.toMatchObject({ code: 'invalid_revision' });
});

it('keeps ordinary folders usable without inventing checkpoint or history support', async () => {
  const folder = path.join(directory, 'folder');
  await fs.mkdir(folder);
  await fs.writeFile(path.join(folder, 'file.txt'), 'ordinary file');
  const repository = await service.open(folder);
  expect(repository.info.backendId).toBe('directory');
  expect(repository.info.capabilities).toEqual({
    review: false,
    checkpoints: false,
    comparisons: false,
    restore: false,
  });
  expect(await repository.review()).toEqual({ repository: repository.info, files: [] });
  await expect(repository.capture()).rejects.toMatchObject({ code: 'unsupported' });
  await expect(repository.resolveRevision('head')).rejects.toMatchObject({ code: 'unsupported' });
  expect(await fs.readdir(folder)).toEqual(['file.txt']);
  // Detection must not stay stuck on a previously unversioned folder.
  await initRepository(folder);
  expect((await service.open(folder)).info.backendId).toBe('git');
});
