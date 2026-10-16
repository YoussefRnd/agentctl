import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createDatabase, projects, sessions } from '../db/index.js';
import { SessionWorkspace } from '../workspace/session-workspace.js';
import { RepositoryCheckpoints } from '../repository/checkpoints.js';
import { createDefaultRepositoryService } from '../default-repository-service.js';
import { SnapshotService } from './snapshot-service.js';
import { WorkspaceManager } from './worktree-manager.js';
import { GitMutex } from './mutex.js';
import { legacyGitRevision } from './legacy-revisions.js';

let directory: string;
const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'workspace-compatibility-'));
});
afterEach(async () => {
  await fs.rm(directory, { recursive: true, force: true });
});
async function fixture() {
  const repo = path.join(directory, 'repo');
  await fs.mkdir(repo);
  git(repo, 'init', '-b', 'main');
  git(repo, 'config', 'user.name', 'Test');
  git(repo, 'config', 'user.email', 'test@example.com');
  git(repo, 'config', 'commit.gpgSign', 'false');
  await fs.writeFile(path.join(repo, 'file.txt'), 'original\n');
  git(repo, 'add', '.');
  git(repo, 'commit', '-m', 'Initial');
  const snapshots = new SnapshotService(path.join(directory, 'snapshots'));
  const manager = new WorkspaceManager(new GitMutex(), path.join(directory, 'worktrees'));
  const repositories = createDefaultRepositoryService(snapshots, manager);
  const databasePath = path.join(directory, 'state.db');
  const db = createDatabase(databasePath);
  db.insert(projects).values({ id: 'p', name: 'Project', path: repo, repoRoot: repo }).run();
  return { repo, snapshots, manager, repositories, databasePath, db };
}

it('reads historical discard records after reopening the database and writes opaque checkpoints afterwards', async () => {
  const f = await fixture();
  const baseline = (await f.snapshots.track(f.repo))!;
  await fs.writeFile(path.join(f.repo, 'file.txt'), 'work before discard\n');
  git(f.repo, 'add', 'file.txt');
  const backup = {
    snapshotHash: (await f.snapshots.track(f.repo))!,
    indexTree: git(f.repo, 'write-tree'),
    headCommit: git(f.repo, 'rev-parse', 'HEAD'),
    postSnapshotHash: '',
    postIndexTree: '',
  };
  await f.snapshots.revertFiles(f.repo, baseline, await f.snapshots.diff(f.repo, baseline));
  await f.manager.withRepositoryLock(f.repo, () => f.manager.unstagePaths(f.repo, ['file.txt']));
  backup.postSnapshotHash = (await f.snapshots.track(f.repo))!;
  backup.postIndexTree = git(f.repo, 'write-tree');
  f.db
    .insert(sessions)
    .values({
      id: 's',
      projectId: 'p',
      branch: 'main',
      worktreePath: f.repo,
      taskSlug: 'legacy',
      baseCommit: baseline,
      status: 'discarded',
      mode: 'local',
      agent: 'provider',
      selectedProvider: 'provider',
      discardBackup: JSON.stringify(backup),
    })
    .run();
  const reopened = createDatabase(f.databasePath);
  const workspace = new SessionWorkspace(reopened, f.repositories, () => {});
  await workspace.undoDiscard('s');
  expect(await fs.readFile(path.join(f.repo, 'file.txt'), 'utf8')).toBe('work before discard\n');
  expect(git(f.repo, 'write-tree')).toBe(backup.indexTree);
  expect((await reopened.query.sessions.findFirst())?.discardBackup).toBeNull();
  const checkpoint = (await new RepositoryCheckpoints(f.repositories).track(f.repo))!;
  expect(checkpoint).toMatch(/^revision:v1:/);
  const again = createDefaultRepositoryService(
    new SnapshotService(path.join(directory, 'snapshots')),
    f.manager,
  );
  const repository = await again.open(f.repo);
  expect(
    (await repository.compare(await repository.importRevision(baseline), checkpoint)).files[0].path,
  ).toBe('file.txt');
  expect(await legacyGitRevision(repository, checkpoint)).toMatch(/^[0-9a-f]{40}$/);
});

it('repairs historical worktree records without replacing their original commit baseline', async () => {
  const f = await fixture();
  const allocated = await f.manager.create(f.repo, 's', 'legacy');
  f.db
    .insert(sessions)
    .values({
      id: 's',
      projectId: 'p',
      branch: allocated.branch,
      worktreePath: allocated.workspacePath,
      taskSlug: 'legacy',
      baseCommit: allocated.baseCommit,
      mode: 'worktree',
      agent: 'provider',
      selectedProvider: 'provider',
    })
    .run();
  await f.manager.cleanup(f.repo, allocated.path, allocated.branch);
  await fs.writeFile(path.join(f.repo, 'file.txt'), 'new project baseline\n');
  git(f.repo, 'commit', '-am', 'Advance project');
  const workspace = new SessionWorkspace(createDatabase(f.databasePath), f.repositories, () => {});
  expect(await workspace.ensureAvailable('s')).toBe(true);
  expect(git(allocated.path, 'rev-parse', 'HEAD')).toBe(allocated.baseCommit);
  expect((await f.db.query.sessions.findFirst())?.baseCommit).toBe(allocated.baseCommit);
});
