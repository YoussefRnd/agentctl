import assert from 'node:assert/strict';
import { it, afterAll } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { WorkspaceManager } from './worktree-manager.js';
import { SnapshotService } from './snapshot-service.js';
import { createDatabase, projects } from '../db/index.js';
import { SessionWorkspace } from './session-workspace.js';
import { GitMutex } from './mutex.js';
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'agentctl-audit-'));
const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
let serial = 0;
async function fixture() {
  const dir = path.join(root, `case-${++serial}`);
  const repo = path.join(dir, 'repo');
  await fs.mkdir(repo, { recursive: true });
  git(repo, 'init', '-b', 'main');
  git(repo, 'config', 'user.name', 'Audit');
  git(repo, 'config', 'user.email', 'audit@example.com');
  git(repo, 'config', 'commit.gpgSign', 'false');
  await fs.writeFile(path.join(repo, 'a.txt'), 'base\n');
  git(repo, 'add', '.');
  git(repo, 'commit', '-m', 'Initial');
  return {
    dir,
    repo,
    manager: new WorkspaceManager(new GitMutex(), path.join(dir, 'worktrees')),
    snapshots: new SnapshotService(path.join(dir, 'snapshots')),
  };
}
function run(name: string, fn: () => Promise<void>) {
  it(name, fn);
}
run('Resolves the symbolic branch before the first commit', async () => {
  const { dir, manager } = await fixture();
  const empty = path.join(dir, 'unborn');
  await fs.mkdir(empty);
  git(empty, 'init', '-b', 'master');
  assert.equal(await manager.getCurrentBranch(empty), 'master');
  assert.deepEqual(await manager.resolveBaseRef(empty), {
    ref: 'master',
    commit: 'empty',
    isEmpty: true,
  });
  assert.equal((await manager.getTrackingStatus(empty, empty)).branch, 'master');
});
run(
  'Unborn review summaries count untracked files even when they are in the session baseline',
  async () => {
    const { dir, manager, snapshots } = await fixture();
    const repo = path.join(dir, 'new-project');
    await fs.mkdir(repo);
    git(repo, 'init', '-b', 'master');
    for (let i = 0; i < 7; i++) await fs.writeFile(path.join(repo, `file-${i}.txt`), 'one\ntwo\n');
    const base = await snapshots.track(repo);
    assert(base);
    const files = await snapshots.getReviewFiles(repo, base, {
      includeDiffs: false,
      scope: 'working',
    });
    assert.equal(files.length, 7);
    assert.equal(
      files.reduce((count, file) => count + (file.additions ?? 0), 0),
      14,
    );
    assert(
      files.every((file) => file.state === 'untracked' && file.hasUnstagedChanges && !file.diff),
    );
    assert.equal(git(repo, 'ls-files'), '');
    await manager.stageAll(repo, repo);
    assert.equal(
      (await snapshots.getReviewFiles(repo, base, { includeDiffs: false, scope: 'working' }))
        .length,
      7,
    );
  },
);
run('Summary counts include untracked files in a repository with commits', async () => {
  const { repo, snapshots } = await fixture();
  await fs.writeFile(path.join(repo, 'preexisting.txt'), 'one\ntwo\n');
  const base = await snapshots.track(repo);
  assert(base);
  const [file] = await snapshots.getReviewFiles(repo, base, {
    includeDiffs: false,
    scope: 'working',
  });
  assert.equal(file.path, 'preexisting.txt');
  assert.equal(file.additions, 2);
  assert.equal(file.deletions, 0);
});
run('Review counts new files in a project subdirectory absent from HEAD', async () => {
  const { repo, snapshots } = await fixture();
  const project = path.join(repo, 'new-package');
  await fs.mkdir(project);
  await fs.writeFile(path.join(project, 'new.txt'), 'one\ntwo\n');
  const base = await snapshots.track(project);
  assert(base);
  const [file] = await snapshots.getReviewFiles(project, base, {
    includeDiffs: false,
    scope: 'working',
  });
  assert.equal(file.path, 'new.txt');
  assert.equal(file.state, 'untracked');
  assert.equal(file.additions, 2);
  assert.equal(file.deletions, 0);
});
run('Local sessions use the checked out branch even when main also exists', async () => {
  const { repo, manager, snapshots } = await fixture();
  git(repo, 'checkout', '-b', 'dev');
  const db = createDatabase(':memory:');
  db.insert(projects).values({ id: 'project', name: 'Project', path: repo, repoRoot: repo }).run();
  const workspace = new SessionWorkspace(
    db,
    manager,
    () => {},
    () => snapshots,
  );
  const session = await workspace.establish('project', 'local', {
    mode: 'local',
    selectedProvider: 'test',
    selectedModel: 'test',
  });
  assert.equal(session.branch, 'dev');
});
run('Reports a detached checkout as HEAD rather than inventing a branch', async () => {
  const { repo, manager } = await fixture();
  git(repo, 'checkout', '--detach');
  assert.equal(await manager.getCurrentBranch(repo), 'HEAD');
  assert.equal((await manager.getTrackingStatus(repo, repo)).branch, 'HEAD');
});
run('Apply refuses uncommitted work without deleting it', async () => {
  const { repo, manager } = await fixture();
  const wt = await manager.create(repo, 'apply', 'apply', 'main');
  await fs.writeFile(path.join(wt.path, 'new.txt'), 'uncommitted work');
  await assert.rejects(
    manager.finalize(repo, wt.path, wt.branch, 'main', 'merge', 'apply', 'Apply work'),
    /Commit or discard/,
  );
  assert.equal(
    await fs
      .access(wt.path)
      .then(() => true)
      .catch(() => false),
    true,
  );
  assert.equal(
    await fs
      .access(path.join(repo, 'new.txt'))
      .then(() => true)
      .catch(() => false),
    false,
  );
});
run('Branch switching rejects a dirty checkout and preserves it', async () => {
  const { repo, manager } = await fixture();
  git(repo, 'branch', 'first');
  git(repo, 'branch', 'second');
  const first = await manager.addBranchWorktree(repo, 'switch', 'first');
  await fs.writeFile(path.join(first.path, 'draft.txt'), 'unsaved work');
  await assert.rejects(manager.addBranchWorktree(repo, 'switch', 'second'), /Commit or stash/);
  assert.equal(await fs.readFile(path.join(first.path, 'draft.txt'), 'utf8'), 'unsaved work');
});
run('rejects a branch already occupied by another checkout', async () => {
  const { repo, manager } = await fixture();
  await assert.rejects(manager.addBranchWorktree(repo, 'shared', 'main'), /already checked out/);
});
run('Merge preview correctly detects a real conflict', async () => {
  const { repo, manager } = await fixture();
  git(repo, 'checkout', '-b', 'topic');
  await fs.writeFile(path.join(repo, 'a.txt'), 'topic\n');
  git(repo, 'commit', '-am', 'Topic change');
  git(repo, 'checkout', 'main');
  await fs.writeFile(path.join(repo, 'a.txt'), 'main\n');
  git(repo, 'commit', '-am', 'Main change');
  let actual = '';
  try {
    git(repo, 'merge-tree', 'main', 'topic');
  } catch (e) {
    actual = String((e as { stdout: unknown }).stdout);
  }
  assert.match(actual, /CONFLICT/);
  assert.equal((await manager.checkMergeConflicts(repo, repo, 'topic')).hasConflicts, true);
});
run('Partial staging reports both index and working changes', async () => {
  const { repo, manager, snapshots } = await fixture();
  const base = await snapshots.track(repo);
  assert(base);
  await fs.writeFile(path.join(repo, 'a.txt'), 'staged\n');
  await manager.stageFile(repo, repo, 'a.txt');
  await fs.writeFile(path.join(repo, 'a.txt'), 'staged\nnot staged\n');
  const [file] = await snapshots.getReviewFiles(repo, base);
  assert.equal(file.state, 'modified');
  assert.equal(file.hasStagedChanges, true);
  assert.equal(file.hasUnstagedChanges, true);
  assert.match(file.diff, /\+not staged/);
  await manager.commit(repo, repo, 'Commit staged part');
  assert.equal(git(repo, 'show', 'HEAD:a.txt'), 'staged');
  assert.match(git(repo, 'diff'), /\+not staged/);
});
run('Subdirectory projects classify modified files correctly', async () => {
  const { repo, snapshots } = await fixture();
  const pkg = path.join(repo, 'pkg');
  await fs.mkdir(pkg);
  await fs.writeFile(path.join(pkg, 'file.txt'), 'base\n');
  git(repo, 'add', '.');
  git(repo, 'commit', '-m', 'Add package');
  const baseline = git(repo, 'rev-parse', 'HEAD');
  await fs.writeFile(path.join(pkg, 'file.txt'), 'changed\n');
  const files = await snapshots.getReviewFiles(pkg, baseline);
  assert.equal(files.find((file) => file.path === 'file.txt')?.state, 'modified');
});
run('Subdirectory commits refuse staged files outside the selected project', async () => {
  const { repo, manager } = await fixture();
  const pkg = path.join(repo, 'pkg');
  await fs.mkdir(pkg);
  await fs.writeFile(path.join(pkg, 'file.txt'), 'package work\n');
  await fs.writeFile(path.join(repo, 'a.txt'), 'unrelated staged work\n');
  git(repo, 'add', 'a.txt');
  const head = git(repo, 'rev-parse', 'HEAD');
  await assert.rejects(manager.commit(repo, pkg, 'Package changes', true), /outside this project/);
  assert.equal(git(repo, 'rev-parse', 'HEAD'), head);
  assert.match(git(repo, 'diff', '--cached', '--', 'a.txt'), /unrelated staged work/);
  await manager.unstageFile(repo, repo, 'a.txt');
  await manager.commit(repo, pkg, 'Package changes');
  assert.equal(git(repo, 'show', 'HEAD:pkg/file.txt'), 'package work');
  assert.match(git(repo, 'diff', '--', 'a.txt'), /unrelated staged work/);
});
run('Changes present at session start are visible in the Git review', async () => {
  const { repo, snapshots } = await fixture();
  await fs.writeFile(path.join(repo, 'a.txt'), 'pre-existing edit\n');
  const base = await snapshots.track(repo);
  assert(base);
  assert.match(git(repo, 'status', '--porcelain'), /M a.txt/);
  assert.equal((await snapshots.getReviewFiles(repo, base)).length, 1);
});
run('Unstage works before the first commit', async () => {
  const { repo, manager } = await fixture();
  const empty = path.join(path.dirname(repo), 'empty');
  await fs.mkdir(empty);
  git(empty, 'init', '-b', 'main');
  await fs.writeFile(path.join(empty, 'a.txt'), 'new');
  await manager.stageFile(empty, empty, 'a.txt');
  await manager.unstageFile(empty, empty, 'a.txt');
  assert.equal(git(empty, 'diff', '--cached', '--name-only'), '');
  await manager.stageFile(empty, empty, 'a.txt');
  await manager.unstageAll(empty, empty);
  assert.equal(git(empty, 'diff', '--cached', '--name-only'), '');
});
run('File staging cannot interpret a filename as a Git option', async () => {
  const { repo, manager } = await fixture();
  await fs.writeFile(path.join(repo, 'first.txt'), 'first');
  await fs.writeFile(path.join(repo, 'second.txt'), 'second');
  await assert.rejects(manager.stageFile(repo, repo, '--all'));
  assert.equal(git(repo, 'diff', '--cached', '--name-only'), '');
});
run('Revert rejects symlink parent traversal', async () => {
  const { dir, repo, manager } = await fixture();
  const outside = path.join(dir, 'outside');
  await fs.mkdir(outside);
  const victim = path.join(outside, 'victim.txt');
  await fs.writeFile(victim, 'keep');
  await fs.symlink(outside, path.join(repo, 'linked'));
  await assert.rejects(manager.revertFile(repo, repo, 'linked/victim.txt'), /symbolic link/);
  assert.equal(
    await fs
      .access(victim)
      .then(() => true)
      .catch(() => false),
    true,
  );
});
run('Pull accepts an ahead-only branch', async () => {
  const { dir, repo, manager } = await fixture();
  const remote = path.join(dir, 'remote.git');
  git(dir, 'init', '--bare', remote);
  git(repo, 'remote', 'add', 'origin', remote);
  git(repo, 'push', '-u', 'origin', 'main');
  await fs.writeFile(path.join(repo, 'a.txt'), 'local commit\n');
  git(repo, 'commit', '-am', 'Local only');
  assert.equal(git(repo, 'rev-list', '--left-right', '--count', 'HEAD...@{upstream}'), '1\t0');
  assert.equal((await manager.pull(repo, repo)).output, 'Already up to date.');
});
run('Push retains the configured upstream', async () => {
  const { dir, repo, manager } = await fixture();
  const upstream = path.join(dir, 'upstream.git'),
    origin = path.join(dir, 'origin.git');
  git(dir, 'init', '--bare', upstream);
  git(dir, 'init', '--bare', origin);
  git(repo, 'remote', 'add', 'upstream', upstream);
  git(repo, 'remote', 'add', 'origin', origin);
  git(repo, 'push', '-u', 'upstream', 'main:trunk');
  assert.equal(git(repo, 'rev-parse', '--abbrev-ref', '@{upstream}'), 'upstream/trunk');
  await manager.push(repo, repo);
  assert.equal(git(repo, 'rev-parse', '--abbrev-ref', '@{upstream}'), 'upstream/trunk');
});
run('Local discard cleans the index and can recover the prior staging', async () => {
  const { repo, manager, snapshots } = await fixture();
  const db = createDatabase(':memory:');
  db.insert(projects).values({ id: 'project', name: 'Project', path: repo, repoRoot: repo }).run();
  const sessions = new SessionWorkspace(
    db,
    manager,
    () => {},
    () => snapshots,
  );
  const session = await sessions.establish('project', 'local', {
    mode: 'local',
    selectedProvider: 'test',
    selectedModel: 'test',
  });
  await fs.writeFile(path.join(repo, 'a.txt'), 'discard me\n');
  await manager.stageFile(repo, repo, 'a.txt');
  await sessions.finalize(session.sessionId, 'discarded');
  assert.equal(await fs.readFile(path.join(repo, 'a.txt'), 'utf8'), 'base\n');
  assert.equal(git(repo, 'diff', '--cached'), '');
  await sessions.undoDiscard(session.sessionId);
  assert.match(git(repo, 'diff', '--cached'), /\+discard me/);
});
run('Local Apply preserves unrelated staging without committing it', async () => {
  const { repo, manager, snapshots } = await fixture();
  await fs.writeFile(path.join(repo, 'prior.txt'), 'keep staged');
  git(repo, 'add', 'prior.txt');
  const db = createDatabase(':memory:');
  db.insert(projects).values({ id: 'project', name: 'Project', path: repo, repoRoot: repo }).run();
  const sessions = new SessionWorkspace(
    db,
    manager,
    () => {},
    () => snapshots,
  );
  const session = await sessions.establish('project', 'local', {
    mode: 'local',
    selectedProvider: 'test',
    selectedModel: 'test',
  });
  await fs.writeFile(path.join(repo, 'a.txt'), 'session change\n');
  await sessions.finalize(session.sessionId, 'merged', { commitMessage: 'Apply local' });
  assert.equal(git(repo, 'diff', '--cached', '--name-only'), 'prior.txt');
  assert.doesNotMatch(git(repo, 'ls-tree', '--name-only', 'HEAD'), /prior.txt/);
});
run('Apply refuses a missing Git baseline until changes are explicitly committed', async () => {
  const { dir, manager, snapshots } = await fixture();
  const repo = path.join(dir, 'opened-before-git');
  await fs.mkdir(repo);
  await fs.writeFile(path.join(repo, 'existing.txt'), 'Earlier work\n');
  const db = createDatabase(':memory:');
  db.insert(projects).values({ id: 'project', name: 'Project', path: repo }).run();
  const workspace = new SessionWorkspace(
    db,
    manager,
    () => {},
    () => snapshots,
  );
  const session = await workspace.establish('project', 'local', {
    mode: 'local',
    selectedProvider: 'test',
    selectedModel: 'test',
  });
  assert.equal(session.baseCommit, 'none');
  git(repo, 'init', '-b', 'main');
  git(repo, 'config', 'user.name', 'Test');
  git(repo, 'config', 'user.email', 'test@example.com');
  git(repo, 'config', 'commit.gpgSign', 'false');
  await fs.writeFile(path.join(repo, 'new.txt'), 'Session work\n');
  await manager.stageFile(repo, repo, 'existing.txt');
  await assert.rejects(
    workspace.finalize(session.sessionId, 'merged'),
    /Commit the workspace changes/,
  );
  const row = await db.query.sessions.findFirst();
  assert.equal(row?.status, 'error');
  assert.equal(row?.closedAt, null);
  assert.equal((await db.query.projects.findFirst())?.repoRoot, repo);
  assert.equal(git(repo, 'diff', '--cached', '--name-only'), 'existing.txt');
  assert.throws(() => git(repo, 'rev-parse', '--verify', 'HEAD'));
  assert.equal(await fs.readFile(path.join(repo, 'new.txt'), 'utf8'), 'Session work\n');
  await manager.commit(repo, repo, 'Explicit initial commit', true);
  await workspace.finalize(session.sessionId, 'merged');
  assert.equal((await db.query.sessions.findFirst())?.status, 'merged');
  assert.equal(git(repo, 'rev-list', '--count', 'HEAD'), '1');
});
run('A failing Apply commit hook restores the clean host checkout', async () => {
  const { repo, manager } = await fixture();
  const wt = await manager.create(repo, 'hook', 'hook', 'main');
  await fs.writeFile(path.join(wt.path, 'feature.txt'), 'feature');
  await manager.stageAll(repo, wt.path);
  await manager.commit(repo, wt.path, 'Feature');
  git(repo, 'config', 'core.hooksPath', path.join(repo, '.git', 'hooks'));
  await fs.writeFile(
    path.join(repo, '.git', 'hooks', 'pre-commit'),
    '#!/bin/sh\necho blocked >&2\nexit 1\n',
    { mode: 0o755 },
  );
  await assert.rejects(
    manager.finalize(repo, wt.path, wt.branch, 'main', 'merge', 'hook', 'Apply feature'),
  );
  assert.equal(git(repo, 'status', '--porcelain'), '');
});
run('Git mutex holds the lock until an aborted operation finishes', async () => {
  const mutex = new GitMutex(),
    controller = new AbortController();
  let active = false,
    overlap = false;
  let start!: () => void;
  const started = new Promise<void>((resolve) => {
    start = resolve;
  });
  const first = mutex
    .run(
      'key',
      async () => {
        active = true;
        start();
        await new Promise((resolve) => setTimeout(resolve, 80));
        active = false;
      },
      { signal: controller.signal },
    )
    .catch(() => {});
  await started;
  controller.abort(new Error('Cancelled'));
  await mutex.run('key', () => {
    overlap = active;
  });
  await first;
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(overlap, false);
});
afterAll(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

it('creates a branch without losing dirty files', async () => {
  const { repo, manager } = await fixture();
  await fs.writeFile(path.join(repo, 'a.txt'), 'keep dirty edits');
  const head = git(repo, 'rev-parse', 'main');
  await manager.createBranch(repo, repo, 'feature/new');
  assert.equal(git(repo, 'branch', '--show-current'), 'feature/new');
  assert.equal(git(repo, 'rev-parse', 'main'), head);
  assert.equal(await fs.readFile(path.join(repo, 'a.txt'), 'utf8'), 'keep dirty edits');
});
it('retains a discarded worktree through cleanup and can resume it', async () => {
  const { repo, manager, snapshots } = await fixture();
  const db = createDatabase(':memory:');
  db.insert(projects).values({ id: 'project', name: 'Project', path: repo, repoRoot: repo }).run();
  const workspace = new SessionWorkspace(
    db,
    manager,
    () => {},
    () => snapshots,
  );
  const session = await workspace.establish('project', 'work', {
    mode: 'worktree',
    selectedProvider: 'test',
    selectedModel: 'test',
  });
  await fs.writeFile(path.join(session.worktreePath, 'draft.txt'), 'keep');
  await workspace.finalize(session.sessionId, 'discarded');
  await workspace.syncOrphans([], [session.sessionId]);
  await workspace.undoDiscard(session.sessionId);
  assert.equal(await fs.readFile(path.join(session.worktreePath, 'draft.txt'), 'utf8'), 'keep');
});
it('refuses to undo local discard over subsequent changes', async () => {
  const { repo, manager, snapshots } = await fixture();
  const db = createDatabase(':memory:');
  db.insert(projects).values({ id: 'project', name: 'Project', path: repo, repoRoot: repo }).run();
  const workspace = new SessionWorkspace(
    db,
    manager,
    () => {},
    () => snapshots,
  );
  const session = await workspace.establish('project', 'local', {
    mode: 'local',
    selectedProvider: 'test',
    selectedModel: 'test',
  });
  await fs.writeFile(path.join(repo, 'a.txt'), 'discard this');
  await workspace.finalize(session.sessionId, 'discarded');
  await fs.writeFile(path.join(repo, 'later.txt'), 'new work');
  await assert.rejects(workspace.undoDiscard(session.sessionId), /Workspace changed/);
  assert.equal(await fs.readFile(path.join(repo, 'later.txt'), 'utf8'), 'new work');
});
it('reads summaries and an individual diff without retaining a review checkpoint', async () => {
  const { repo, snapshots } = await fixture();
  const base = git(repo, 'rev-parse', 'HEAD');
  await fs.writeFile(path.join(repo, 'a.txt'), 'changed');
  const refs = git(repo, 'for-each-ref', 'refs/agentctl/snapshots');
  const [summary] = await snapshots.getReviewFiles(repo, base, {
    includeDiffs: false,
    scope: 'working',
  });
  assert.equal(summary.diff, '');
  const [detail] = await snapshots.getReviewFiles(repo, base, {
    filePath: 'a.txt',
    scope: 'working',
  });
  assert.match(detail.diff, /\+changed/);
  assert.equal(git(repo, 'for-each-ref', 'refs/agentctl/snapshots'), refs);
});
it('fetches and pulls the differently named upstream branch', async () => {
  const { dir, repo, manager } = await fixture();
  const remote = path.join(dir, 'remote.git');
  git(dir, 'init', '--bare', remote);
  git(repo, 'remote', 'add', 'origin', remote);
  git(repo, 'push', '-u', 'origin', 'main:trunk');
  const clone = path.join(dir, 'clone');
  git(dir, 'clone', '--branch', 'trunk', remote, clone);
  git(clone, 'config', 'user.name', 'Test');
  git(clone, 'config', 'user.email', 'test@example.com');
  git(clone, 'config', 'commit.gpgSign', 'false');
  await fs.writeFile(path.join(clone, 'remote.txt'), 'remote');
  git(clone, 'add', '.');
  git(clone, 'commit', '-m', 'Remote');
  git(clone, 'push');
  await manager.fetch(repo, repo);
  assert.equal((await manager.getTrackingStatus(repo, repo)).behindCount, 1);
  await manager.pull(repo, repo);
  assert.equal(await fs.readFile(path.join(repo, 'remote.txt'), 'utf8'), 'remote');
});

it('preserves dirty files when archiving and resuming a worktree', async () => {
  const { repo, manager, snapshots } = await fixture();
  const db = createDatabase(':memory:');
  db.insert(projects).values({ id: 'project', name: 'Project', path: repo, repoRoot: repo }).run();
  const workspace = new SessionWorkspace(
    db,
    manager,
    () => {},
    () => snapshots,
  );
  const session = await workspace.establish('project', 'archive', {
    mode: 'worktree',
    selectedProvider: 'test',
    selectedModel: 'test',
  });
  await fs.writeFile(path.join(session.worktreePath, 'draft.txt'), 'keep');
  await workspace.archive(session.sessionId);
  const resumed = await workspace.activate(session.sessionId);
  assert.equal(resumed.worktreePath, session.worktreePath);
  assert.equal(await fs.readFile(path.join(resumed.worktreePath, 'draft.txt'), 'utf8'), 'keep');
});
it('caches PR lookups outside the repository mutation lock', async () => {
  const { repo, manager } = await fixture();
  git(repo, 'remote', 'add', 'origin', 'https://github.com/example/project.git');
  let release!: () => void,
    notify!: () => void,
    calls = 0;
  const started = new Promise<void>((resolve) => {
    notify = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  manager.detectPullRequest = async () => {
    calls++;
    notify();
    await gate;
    return null;
  };
  const status = manager.getTrackingStatus(repo, repo);
  await started;
  await fs.writeFile(path.join(repo, 'new.txt'), 'new');
  await manager.stageFile(repo, repo, 'new.txt');
  release();
  await status;
  await manager.getTrackingStatus(repo, repo);
  assert.equal(calls, 1);
});

it('keeps literal Unicode, whitespace, and backslash filenames in the review', async () => {
  const { repo, manager, snapshots } = await fixture();
  const base = git(repo, 'rev-parse', 'HEAD');
  const name = 'café with spaces.txt';
  await fs.writeFile(path.join(repo, name), 'content');
  await manager.stageFile(repo, repo, name);
  const files = await snapshots.getReviewFiles(repo, base, { scope: 'working' });
  assert.equal(files.find((file) => file.path === name)?.state, 'staged');
  const literal = 'back\\slash.txt';
  await fs.writeFile(path.join(repo, literal), 'literal');
  await manager.revertFile(repo, repo, literal);
  assert.equal(
    await fs
      .access(path.join(repo, literal))
      .then(() => true)
      .catch(() => false),
    false,
  );
});
