import { afterAll, expect, it } from 'vite-plus/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { WorkspaceManager } from './worktree-manager.js';
import { GitMutex } from './mutex.js';
import { SessionWorkspace } from './session-workspace.js';
import { SnapshotService } from './snapshot-service.js';
import { createDatabase, projects } from '../db/index.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'agentctl-merge-safety-'));
const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
let sequence = 0;
async function fixture() {
  const directory = path.join(root, String(++sequence));
  const repo = path.join(directory, 'repo');
  const storage = path.join(directory, 'worktrees');
  await fs.mkdir(repo, { recursive: true });
  git(repo, 'init', '-b', 'main');
  git(repo, 'config', 'user.name', 'Test');
  git(repo, 'config', 'user.email', 'test@example.com');
  git(repo, 'config', 'commit.gpgSign', 'false');
  await fs.writeFile(path.join(repo, 'base.txt'), 'base\n');
  await fs.writeFile(path.join(repo, '.gitignore'), '*.local\n');
  git(repo, 'add', '.');
  git(repo, 'commit', '-m', 'Initial');
  const manager = new WorkspaceManager(new GitMutex(), storage);
  const worktree = await manager.create(repo, 'session', 'feature', 'main');
  await fs.writeFile(path.join(worktree.path, 'feature.txt'), 'feature\n');
  git(worktree.path, 'add', '.');
  git(worktree.path, 'commit', '-m', 'Feature');
  const apply = () =>
    manager.finalize(
      repo,
      worktree.path,
      worktree.branch,
      'main',
      'merge',
      'feature',
      'Apply feature',
    );
  return { repo, directory, storage, manager, worktree, apply };
}
afterAll(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

it('retains source history and ignored files after merge, and retry is idempotent', async () => {
  const { repo, worktree, manager, apply } = await fixture();
  const source = git(worktree.path, 'rev-parse', 'HEAD');
  await fs.writeFile(path.join(worktree.path, 'settings.local'), 'private local work');
  await apply();
  expect(await fs.readFile(path.join(repo, 'feature.txt'), 'utf8')).toBe('feature\n');
  expect(await fs.readFile(path.join(worktree.path, 'settings.local'), 'utf8')).toBe(
    'private local work',
  );
  expect(git(repo, 'rev-parse', worktree.branch)).toBe(source);
  const applied = git(repo, 'rev-parse', 'main');
  await apply();
  expect(git(repo, 'rev-parse', 'main')).toBe(applied);
  expect(
    (await manager.getMergePreview(repo, worktree.path, worktree.branch, 'main')).blockedReason,
  ).toBeNull();
});

it('merges into main in another checkout without touching a dirty host branch', async () => {
  const { repo, directory, worktree, apply } = await fixture();
  git(repo, 'checkout', '-b', 'dev');
  const target = path.join(directory, 'main-checkout');
  git(repo, 'worktree', 'add', target, 'main');
  await fs.writeFile(path.join(repo, 'base.txt'), 'dirty host edits\n');
  git(repo, 'add', 'base.txt');
  const index = git(repo, 'write-tree');
  await apply();
  expect(git(repo, 'branch', '--show-current')).toBe('dev');
  expect(git(repo, 'write-tree')).toBe(index);
  expect(await fs.readFile(path.join(repo, 'base.txt'), 'utf8')).toBe('dirty host edits\n');
  expect(await fs.readFile(path.join(target, 'feature.txt'), 'utf8')).toBe('feature\n');
  expect((await fs.stat(worktree.path)).isDirectory()).toBe(true);
});

it('updates an unoccupied destination without switching a detached host checkout', async () => {
  const { repo, apply } = await fixture();
  const original = git(repo, 'rev-parse', 'HEAD');
  git(repo, 'checkout', '--detach');
  await fs.writeFile(path.join(repo, 'base.txt'), 'keep detached edits');
  await apply();
  expect(git(repo, 'rev-parse', 'HEAD')).toBe(original);
  expect(git(repo, 'branch', '--show-current')).toBe('');
  expect(git(repo, 'show', 'main:feature.txt')).toBe('feature');
  expect(await fs.readFile(path.join(repo, 'base.txt'), 'utf8')).toBe('keep detached edits');
});

it('refuses a dirty destination before changing source history or staging', async () => {
  const { repo, worktree, manager, apply } = await fixture();
  await fs.writeFile(path.join(repo, 'new-main.txt'), 'main advance');
  git(repo, 'add', '.');
  git(repo, 'commit', '-m', 'Advance main');
  await fs.writeFile(path.join(repo, 'base.txt'), 'uncommitted destination');
  git(repo, 'add', 'base.txt');
  const index = git(repo, 'write-tree');
  const source = git(worktree.path, 'rev-parse', 'HEAD');
  const preview = await manager.getMergePreview(repo, worktree.path, worktree.branch, 'main');
  expect(preview.blockedReason).toContain('Commit or stash');
  await expect(apply()).rejects.toThrow('Working tree is not clean');
  expect(git(worktree.path, 'rev-parse', 'HEAD')).toBe(source);
  expect(git(repo, 'write-tree')).toBe(index);
  expect(await fs.readFile(path.join(repo, 'base.txt'), 'utf8')).toBe('uncommitted destination');
});

it('keeps ignored destination files that collide with committed source files', async () => {
  const { repo, worktree, apply } = await fixture();
  await fs.writeFile(path.join(repo, 'settings.local'), 'destination secret');
  await fs.writeFile(path.join(worktree.path, 'settings.local'), 'source version');
  git(worktree.path, 'add', '-f', 'settings.local');
  git(worktree.path, 'commit', '-m', 'Track settings');
  const before = git(repo, 'rev-parse', 'main');
  await expect(apply()).rejects.toThrow();
  expect(git(repo, 'rev-parse', 'main')).toBe(before);
  expect(await fs.readFile(path.join(repo, 'settings.local'), 'utf8')).toBe('destination secret');
});

it('keeps ignored source files when main introduces a conflicting tracked file', async () => {
  const { repo, worktree, apply } = await fixture();
  await fs.writeFile(path.join(worktree.path, 'settings.local'), 'source secret');
  await fs.writeFile(path.join(repo, 'settings.local'), 'main version');
  git(repo, 'add', '-f', 'settings.local');
  git(repo, 'commit', '-m', 'Track settings');
  const before = git(worktree.path, 'rev-parse', 'HEAD');
  await expect(apply()).rejects.toThrow();
  expect(git(worktree.path, 'rev-parse', 'HEAD')).toBe(before);
  expect(await fs.readFile(path.join(worktree.path, 'settings.local'), 'utf8')).toBe(
    'source secret',
  );
});

it('keeps hook edits in the preparation worktree after a failed squash commit', async () => {
  const { repo, storage, worktree, apply } = await fixture();
  const before = git(repo, 'rev-parse', 'HEAD');
  await fs.writeFile(
    path.join(repo, '.git', 'hooks', 'pre-commit'),
    '#!/bin/sh\nprintf "hook work" > hook.txt\nprintf "ignored hook work" > hook.local\nexit 1\n',
    { mode: 0o755 },
  );
  await expect(apply()).rejects.toThrow('Merge preparation is available at');
  expect(git(repo, 'rev-parse', 'HEAD')).toBe(before);
  expect(git(repo, 'status', '--porcelain')).toBe('');
  const preparations = (await fs.readdir(storage)).filter((name) => name.startsWith('.apply-'));
  expect(preparations).toHaveLength(1);
  const preparation = path.join(storage, preparations[0]);
  expect(await fs.readFile(path.join(preparation, 'hook.txt'), 'utf8')).toBe('hook work');
  expect(await fs.readFile(path.join(preparation, 'hook.local'), 'utf8')).toBe('ignored hook work');
  expect(git(preparation, 'diff', '--cached', '--name-only')).toBe('feature.txt');
  expect(await fs.readFile(path.join(worktree.path, 'feature.txt'), 'utf8')).toBe('feature\n');
});

it('does not remove ignored files created by a successful commit hook', async () => {
  const { repo, storage, apply } = await fixture();
  await fs.writeFile(
    path.join(repo, '.git', 'hooks', 'pre-commit'),
    '#!/bin/sh\nprintf "keep" > hook.local\n',
    { mode: 0o755 },
  );
  await apply();
  const preparations = (await fs.readdir(storage)).filter((name) => name.startsWith('.apply-'));
  expect(preparations).toHaveLength(1);
  expect(await fs.readFile(path.join(storage, preparations[0], 'hook.local'), 'utf8')).toBe('keep');
});

it('refuses unstaged edits alongside staged conflict resolutions', async () => {
  const { repo, worktree, manager, apply } = await fixture();
  await fs.writeFile(path.join(worktree.path, 'base.txt'), 'source\n');
  git(worktree.path, 'commit', '-am', 'Source conflict');
  await fs.writeFile(path.join(repo, 'base.txt'), 'destination\n');
  git(repo, 'commit', '-am', 'Destination conflict');
  await expect(apply()).rejects.toThrow('Merge conflict');
  await fs.writeFile(path.join(worktree.path, 'base.txt'), 'resolved\n');
  git(worktree.path, 'add', 'base.txt');
  await fs.writeFile(path.join(worktree.path, 'feature.txt'), 'unstaged work');
  const source = git(worktree.path, 'rev-parse', 'HEAD');
  const preview = await manager.getMergePreview(repo, worktree.path, worktree.branch, 'main');
  expect(preview.hasMergeHead).toBe(true);
  expect(preview.blockedReason).toContain('Stage all');
  await expect(apply()).rejects.toThrow('Stage all');
  expect(git(worktree.path, 'rev-parse', 'HEAD')).toBe(source);
  expect(await fs.readFile(path.join(worktree.path, 'feature.txt'), 'utf8')).toBe('unstaged work');
  git(worktree.path, 'add', 'feature.txt');
  await apply();
  expect(await fs.readFile(path.join(repo, 'base.txt'), 'utf8')).toBe('resolved\n');
  expect(await fs.readFile(path.join(repo, 'feature.txt'), 'utf8')).toBe('unstaged work');
});

it('preview fails closed for missing refs and lists exact conflict paths', async () => {
  const { repo, worktree, manager } = await fixture();
  await expect(manager.checkMergeConflicts(repo, repo, 'missing-branch')).rejects.toThrow();
  const name = 'conflict\twith space.txt';
  await fs.writeFile(path.join(repo, name), 'base\n');
  git(repo, 'add', '.');
  git(repo, 'commit', '-m', 'Base file');
  git(worktree.path, 'merge', 'main');
  await fs.writeFile(path.join(worktree.path, name), 'source\n');
  git(worktree.path, 'commit', '-am', 'Source');
  await fs.writeFile(path.join(repo, name), 'target\n');
  git(repo, 'commit', '-am', 'Target');
  expect(await manager.checkMergeConflicts(repo, repo, worktree.branch)).toEqual({
    hasConflicts: true,
    conflictingFiles: [name],
  });
  expect(git(repo, 'status', '--porcelain')).toBe('');
  expect(git(worktree.path, 'status', '--porcelain')).toBe('');
});

it('does not merge a branch different from the session record', async () => {
  const { repo, worktree, apply } = await fixture();
  git(worktree.path, 'checkout', '-b', 'unexpected');
  const before = git(repo, 'rev-parse', 'main');
  await expect(apply()).rejects.toThrow('workspace branch has changed');
  expect(git(repo, 'rev-parse', 'main')).toBe(before);
});

it('keeps merged worktrees through startup sync until explicit deletion', async () => {
  const { repo, manager, directory } = await fixture();
  const db = createDatabase(':memory:');
  db.insert(projects).values({ id: 'project', name: 'Test', path: repo, repoRoot: repo }).run();
  const snapshots = new SnapshotService(path.join(directory, 'snapshots'));
  const workspace = new SessionWorkspace(
    db,
    manager,
    () => {},
    () => snapshots,
  );
  const session = await workspace.establish('project', 'finished', {
    mode: 'worktree',
    selectedProvider: 'test',
    selectedModel: 'test',
  });
  await fs.writeFile(path.join(session.worktreePath, 'draft.local'), 'retained');
  await fs.writeFile(path.join(session.worktreePath, 'done.txt'), 'done');
  git(session.worktreePath, 'add', '.');
  git(session.worktreePath, 'commit', '-m', 'Done');
  await workspace.finalize(session.sessionId, 'merged');
  expect(
    (await db.query.sessions.findFirst({ where: (row, { eq }) => eq(row.id, session.sessionId) }))
      ?.status,
  ).toBe('merged');
  await workspace.syncOrphans([], [session.sessionId]);
  expect(await fs.readFile(path.join(session.worktreePath, 'draft.local'), 'utf8')).toBe(
    'retained',
  );
  await workspace.teardown(session.sessionId);
  await expect(fs.stat(session.worktreePath)).rejects.toThrow();
});

it('preserves destination edits made while a commit hook prepares the merge', async () => {
  const { repo, worktree, apply } = await fixture();
  const before = git(repo, 'rev-parse', 'main');
  await fs.writeFile(
    path.join(repo, '.git', 'hooks', 'pre-commit'),
    `#!/bin/sh\nprintf 'concurrent user work' > '${repo}/base.txt'\n`,
    { mode: 0o755 },
  );
  await expect(apply()).rejects.toThrow('Working tree is not clean');
  expect(git(repo, 'rev-parse', 'main')).toBe(before);
  expect(await fs.readFile(path.join(repo, 'base.txt'), 'utf8')).toBe('concurrent user work');
  expect(await fs.readFile(path.join(worktree.path, 'feature.txt'), 'utf8')).toBe('feature\n');
});

it('does not overwrite a destination commit made while preparing the merge', async () => {
  const { repo, apply } = await fixture();
  await fs.writeFile(
    path.join(repo, '.git', 'hooks', 'pre-commit'),
    `#!/bin/sh\nunset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_PREFIX GIT_COMMON_DIR\ngit -C '${repo}' -c core.hooksPath=/dev/null commit --allow-empty -m 'Concurrent commit'\n`,
    { mode: 0o755 },
  );
  await expect(apply()).rejects.toThrow('main changed while preparing the merge');
  expect(git(repo, 'log', '-1', '--format=%s', 'main')).toBe('Concurrent commit');
  expect(git(repo, 'status', '--porcelain')).toBe('');
});

it('checks nested project changes and blocks changes outside the selected folder', async () => {
  const { repo, worktree, manager } = await fixture();
  await fs.mkdir(path.join(worktree.path, 'package'));
  await fs.writeFile(path.join(worktree.path, 'package', 'app.txt'), 'draft');
  let preview = await manager.getMergePreview(
    repo,
    path.join(worktree.path, 'package'),
    worktree.branch,
    'main',
  );
  expect(preview.uncommittedCount).toBe(1);
  expect(preview.blockedReason).toBeNull();
  await fs.writeFile(path.join(worktree.path, 'outside.txt'), 'outside work');
  preview = await manager.getMergePreview(
    repo,
    path.join(worktree.path, 'package'),
    worktree.branch,
    'main',
  );
  expect(preview.blockedReason).toContain('outside this project');
});

it('refuses automatic worktree removal when ignored files would be lost', async () => {
  const { repo, worktree, manager } = await fixture();
  await fs.writeFile(path.join(worktree.path, 'settings.local'), 'keep local work');
  await expect(manager.removeWorktreeOnly(repo, worktree.path)).rejects.toThrow(
    'ignored local files',
  );
  expect(await fs.readFile(path.join(worktree.path, 'settings.local'), 'utf8')).toBe(
    'keep local work',
  );
});

it('branch switching preserves ignored files that the new branch tracks', async () => {
  const { repo, worktree, manager } = await fixture();
  git(repo, 'checkout', '-b', 'target');
  await fs.writeFile(path.join(repo, 'settings.local'), 'tracked target value');
  git(repo, 'add', '-f', 'settings.local');
  git(repo, 'commit', '-m', 'Track local file');
  git(repo, 'checkout', 'main');
  await fs.writeFile(path.join(worktree.path, 'settings.local'), 'keep source value');
  await expect(
    manager.addBranchWorktree(repo, 'session', 'target', '', undefined, worktree.path),
  ).rejects.toThrow('overwrite ignored file');
  expect(await fs.readFile(path.join(worktree.path, 'settings.local'), 'utf8')).toBe(
    'keep source value',
  );
  expect(git(worktree.path, 'branch', '--show-current')).toBe(worktree.branch);
});

it('workspace setup does not overwrite tracked environment files from its base branch', async () => {
  const { repo, manager } = await fixture();
  await fs.writeFile(path.join(repo, '.env'), 'base version');
  git(repo, 'add', '.env');
  git(repo, 'commit', '-m', 'Track environment file');
  git(repo, 'checkout', '-b', 'host');
  await fs.writeFile(path.join(repo, '.env'), 'different host version');
  git(repo, 'commit', '-am', 'Change host environment');
  const created = await manager.create(repo, 'env-session', 'environment', 'main');
  expect(await fs.readFile(path.join(created.path, '.env'), 'utf8')).toBe('base version');
  expect(git(created.path, 'status', '--porcelain')).toBe('');
});
