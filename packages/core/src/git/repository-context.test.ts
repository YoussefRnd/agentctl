import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { resolveRepositoryContext } from './repository-context.js';
import { WorkspaceManager } from './worktree-manager.js';
import { GitMutex } from './mutex.js';
import { SnapshotService } from './snapshot-service.js';

let directory: string;
const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'repository-context-'));
});
afterEach(async () => {
  await fs.rm(directory, { recursive: true, force: true });
});

it('resolves a symlinked subproject in a linked worktree consistently for captures and workspace operations', async () => {
  const repository = path.join(directory, 'repo');
  const worktree = path.join(directory, 'worktree');
  const alias = path.join(directory, 'alias');
  await fs.mkdir(path.join(repository, 'pkg'), { recursive: true });
  git(repository, 'init', '-b', 'main');
  git(repository, 'config', 'user.name', 'Test');
  git(repository, 'config', 'user.email', 'test@example.com');
  await fs.writeFile(path.join(repository, 'pkg', 'file.txt'), 'before\n');
  git(repository, 'add', '.');
  git(repository, '-c', 'commit.gpgSign=false', 'commit', '-m', 'baseline');
  git(repository, 'worktree', 'add', '-b', 'feature', worktree);
  await fs.symlink(path.join(worktree, 'pkg'), alias);
  const context = await resolveRepositoryContext(alias);
  expect(context).toMatchObject({
    selectedPath: await fs.realpath(path.join(worktree, 'pkg')),
    isGitRepo: true,
    repoRoot: await fs.realpath(worktree),
    workdirPrefix: 'pkg',
  });
  expect(context.gitDir).not.toBe(path.join(repository, '.git'));
  expect(context.indexPath).toBe(path.join(context.gitDir!, 'index'));
  const manager = new WorkspaceManager(new GitMutex());
  expect(await manager.resolveRepository(alias)).toMatchObject({
    selectedPath: context.selectedPath,
    repoRoot: context.repoRoot,
    workdirPrefix: context.workdirPrefix,
  });
  const snapshots = new SnapshotService(path.join(directory, 'snapshots'));
  const baseline = await snapshots.track(alias);
  expect(await snapshots.track(context.selectedPath)).toBe(baseline);
  await fs.writeFile(path.join(alias, 'file.txt'), 'after\n');
  const [review] = await snapshots.getReviewFiles(alias, baseline!);
  expect(review.path).toBe('file.txt');
  expect(review.diff).toContain('+after');
  expect(git(repository, 'show', 'HEAD:pkg/file.txt')).toBe('before');
});

it('recognizes folders without Git and rejects a file selected as a project', async () => {
  expect(await resolveRepositoryContext(directory)).toMatchObject({
    isGitRepo: false,
    repoRoot: null,
    gitDir: null,
    indexPath: null,
  });
  const file = path.join(directory, 'file.txt');
  await fs.writeFile(file, 'content');
  await expect(resolveRepositoryContext(file)).rejects.toThrow('Selected path is not a directory');
});

it('preserves missing-project behavior for snapshot reads', async () => {
  const snapshots = new SnapshotService(path.join(directory, 'snapshots'));
  const missing = path.join(directory, 'missing');
  expect(await snapshots.track(missing)).toBeUndefined();
  expect(await snapshots.getReview(missing, 'none')).toEqual({ files: [] });
});
