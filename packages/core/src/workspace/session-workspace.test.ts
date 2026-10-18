import { describeWorkspace } from './workspace-context.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { afterEach, beforeEach, expect, it, vi } from 'vite-plus/test';
import { eq } from 'drizzle-orm';
import { createDatabase, projects, sessions } from '../db/index.js';
import { RepositoryService } from '../repository/repository-service.js';
import { RepositoryCheckpoints } from '../repository/checkpoints.js';
import { DirectoryBackend } from '../repository/directory-backend.js';
import type { RepositoryBackend, BackendWorkspace } from '../repository/types.js';
import { SessionWorkspace } from './session-workspace.js';
import {
  SessionHistoryService,
  type SessionHistoryDependencies,
} from '../session/services/session-history-service.js';
import { SessionEventRepository } from '../session/persistence/session-event-repository.js';
import { ConversationProjector } from '../session/projection/conversation-projector.js';
import { noopLogger } from '../logger.js';

let root: string;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'neutral-workspace-'));
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

/** A file-backed test VCS with named revisions, allocation and recoverable restore; no Git commands. */
async function fixture() {
  const project = path.join(root, 'project');
  await fs.mkdir(project);
  await fs.writeFile(path.join(project, 'file.txt'), 'original\n');
  const saved = new Map<string, string>();
  let sequence = 0;
  const capture = async (directory: string) => {
    const id = `saved change/${++sequence}/α`;
    saved.set(id, await fs.readFile(path.join(directory, 'file.txt'), 'utf8'));
    return id;
  };
  const restore = async (directory: string, id: string) => {
    if (!saved.has(id)) throw new Error('Unknown checkpoint');
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(path.join(directory, 'file.txt'), saved.get(id)!);
  };
  const applied = vi.fn(async () => {});
  const retired = vi.fn(async (directory: string) => {
    await fs.rm(directory, { recursive: true });
  });
  const backend: RepositoryBackend = {
    id: 'named-history',
    open: async (directory) => {
      const workspace: BackendWorkspace = {
        identity: {
          repositoryId: 'test-repository',
          workspaceId: directory,
          workspacePath: directory,
          rootPath: project,
          scope: '',
        },
        capture: () => capture(directory),
        review: async (baseline) => ({
          files: [],
          capture: { baseline: baseline!, current: await capture(directory), working: baseline! },
        }),
        compare: async (from, to) => {
          if (!saved.has(from) || !saved.has(to)) throw new Error('Unknown checkpoint');
          return {
            files:
              saved.get(from) === saved.get(to)
                ? []
                : [{ path: 'file.txt', status: 'modified', additions: 1, deletions: 1 }],
            totalAdditions: 1,
            totalDeletions: 1,
          };
        },
        diff: async () => [],
        restore: async (revision) => {
          const backup = await capture(directory);
          await restore(directory, revision);
          return {
            backup,
            restoredFiles: [{ path: 'file.txt', status: 'modified', additions: 1, deletions: 1 }],
          };
        },
        lifecycle: {
          allocate: async (input) => {
            const location = path.join(root, input.sessionId);
            const baseline = await capture(project);
            await restore(location, baseline);
            return { path: location, label: `workspace ${input.sessionId}`, baseline };
          },
          restore: async (binding) => {
            await restore(binding.path, binding.baseline!);
          },
          retire: async (binding) => {
            await retired(binding.path);
          },
          sync: async () => {},
        },
        integration: {
          preview: async () => ({ hasMergeHead: false, blockedReason: null }),
          apply: async (binding) => {
            expect(saved.has(binding.baseline!)).toBe(true);
            await applied();
          },
          discard: async (binding) => {
            const backup = await capture(binding.path);
            await restore(binding.path, binding.baseline!);
            return backup;
          },
          undoDiscard: async (binding, recovery) => {
            await restore(binding.path, recovery);
          },
          forgetRecovery: async () => {},
        },
      };
      return workspace;
    },
  };
  const repositories = new RepositoryService([backend]);
  const db = createDatabase(':memory:');
  db.insert(projects).values({ id: 'p', name: 'Project', path: project }).run();
  const stop = vi.fn(async () => {});
  const workspace = new SessionWorkspace(db, repositories, stop);
  const establish = (mode?: 'local' | 'worktree') =>
    workspace.establish('p', 'task', {
      selectedProvider: 'provider',
      selectedModel: 'model',
      mode,
    });
  return {
    db,
    repositories,
    backend,
    workspace,
    establish,
    project,
    applied,
    retired,
    stop,
    saved,
  };
}

it('allocates, retains, reopens, discards, recovers, integrates, and retires a non-Git workspace', async () => {
  const f = await fixture();
  const session = await f.establish();
  expect(session.mode).toBe('worktree');
  expect(session.baseCommit).toMatch(/^revision:v1:/);
  const file = path.join(session.worktreePath, 'file.txt');
  await fs.writeFile(file, 'retained work\n');
  await f.workspace.archive(session.sessionId);
  const reopened = new SessionWorkspace(f.db, new RepositoryService([f.backend]), f.stop);
  const active = await reopened.activate(session.sessionId);
  expect(active.baseCommit).toBe(session.baseCommit);
  expect(await fs.readFile(file, 'utf8')).toBe('retained work\n');
  await reopened.finalize(session.sessionId, 'discarded');
  const discarded = await f.db.query.sessions.findFirst({
    where: eq(sessions.id, session.sessionId),
  });
  expect(discarded?.discardBackup).toMatch(/^recovery:v1:/);
  expect(await fs.readFile(file, 'utf8')).toBe('original\n');
  await reopened.undoDiscard(session.sessionId);
  expect(await fs.readFile(file, 'utf8')).toBe('retained work\n');
  await reopened.finalize(session.sessionId, 'merged');
  expect(f.applied).toHaveBeenCalledOnce();
  await reopened.teardown(session.sessionId);
  expect(f.retired).toHaveBeenCalledWith(session.worktreePath);
  expect(await f.db.query.sessions.findFirst()).toBeUndefined();
});

it('persists turn checkpoints and performs preview, rewind, undo and explicit restore with non-Git revisions', async () => {
  const f = await fixture();
  const session = await f.establish('local');
  const events = new SessionEventRepository(f.db, { publish: vi.fn() });
  const checkpoints = new RepositoryCheckpoints(f.repositories);
  const projector = new ConversationProjector(
    session.sessionId,
    events,
    noopLogger,
    f.project,
    checkpoints,
  );
  const turn = await projector.startTurn('Make a change');
  const checkpoint = await turn.snapshotPromise;
  expect(checkpoint).toMatch(/^revision:v1:/);
  const stored = await events.getEventWithMetadata(session.sessionId, turn.eventId);
  expect(stored?.metadata).toMatchObject({ snapshotHash: checkpoint });
  await fs.writeFile(path.join(f.project, 'file.txt'), 'agent change\n');
  const end = await checkpoints.track(f.project);
  expect((await checkpoints.getTurnChanges(f.project, checkpoint!, end)).files[0].path).toBe(
    'file.txt',
  );
  await events.append(session.sessionId, 'text', { role: 'provider', content: 'Changed it' });
  const restart = vi.fn(async () => ({}));
  const history = new SessionHistoryService({
    db: f.db,
    logger: noopLogger,
    eventRepository: events,
    runtimeRegistry: {
      getSession: () => undefined,
      getRepositoryService: () => f.repositories,
      stopSessionAndWait: f.stop,
    },
    restartSession: restart,
  } as unknown as SessionHistoryDependencies);
  expect(await history.previewSnapshotDiff(session.sessionId, turn.eventId)).toMatchObject({
    hasSnapshot: true,
    files: [{ path: 'file.txt' }],
  });
  const result = await history.rewindSession(session.sessionId, turn.eventId, 'files');
  expect(result.undoSnapshotHash).toMatch(/^revision:v1:/);
  expect(await fs.readFile(path.join(f.project, 'file.txt'), 'utf8')).toBe('original\n');
  expect(await f.db.query.sessionEvents.findMany()).toHaveLength(0);
  await history.undoRewind(session.sessionId);
  expect(await fs.readFile(path.join(f.project, 'file.txt'), 'utf8')).toBe('agent change\n');
  expect(await f.db.query.sessionEvents.findMany()).toHaveLength(2);
  const restore = await history.restoreSnapshot(session.sessionId, checkpoint!);
  expect(restore.backupHash).toMatch(/^revision:v1:/);
  expect(await fs.readFile(path.join(f.project, 'file.txt'), 'utf8')).toBe('original\n');
  await projector.flushAll();
});

it('repairs a missing allocation with its persisted opaque baseline', async () => {
  const f = await fixture();
  const session = await f.establish();
  await fs.rm(session.worktreePath, { recursive: true });
  await fs.writeFile(path.join(f.project, 'file.txt'), 'later project work\n');
  expect(await f.workspace.ensureAvailable(session.sessionId)).toBe(true);
  expect(await fs.readFile(path.join(session.worktreePath, 'file.txt'), 'utf8')).toBe('original\n');
  expect((await f.db.query.sessions.findFirst())?.baseCommit).toBe(session.baseCommit);
});

it('rejects mismatched or malformed references without silently importing native IDs', async () => {
  const f = await fixture();
  const first = await f.establish('local');
  const other = await new RepositoryService([{ ...f.backend, id: 'other' }]).open(f.project);
  await expect(other.importRevision(first.baseCommit)).rejects.toMatchObject({
    code: 'invalid_revision',
  });
  const repository = await f.repositories.open(f.project);
  for (const revision of ['raw history label', 'revision:v2:future', 'revision:v1:bad']) {
    await expect(repository.importRevision(revision)).rejects.toMatchObject({
      code: 'invalid_revision',
    });
  }
});

it('keeps folder sessions usable while unsupported history, staging, isolation and integration are explicit', async () => {
  const f = await fixture();
  const folders = new RepositoryService([new DirectoryBackend()]);
  const workspace = new SessionWorkspace(f.db, folders, f.stop);
  const session = await workspace.establish('p', 'folder', {
    selectedProvider: 'provider',
    selectedModel: 'model',
  });
  expect(session.mode).toBe('local');
  expect(await new RepositoryCheckpoints(folders).track(f.project)).toBeUndefined();
  expect(await describeWorkspace(folders, f.project)).toContain('Workspace review is unavailable.');
  expect(await describeWorkspace(folders, f.project)).not.toContain('clean');
  const handle = await workspace.getHandle(session.sessionId);
  await expect(handle.stageFile('file.txt')).rejects.toMatchObject({ code: 'unsupported' });
  await expect(workspace.activate(session.sessionId, { mode: 'worktree' })).rejects.toMatchObject({
    code: 'unsupported',
  });
  await expect(workspace.finalize(session.sessionId, 'merged')).rejects.toMatchObject({
    code: 'unsupported',
  });
  await workspace.archive(session.sessionId);
  await workspace.activate(session.sessionId);
  await workspace.teardown(session.sessionId);
  expect(await fs.readFile(path.join(f.project, 'file.txt'), 'utf8')).toBe('original\n');
});

it('retains the local baseline and edits across archive and reopening', async () => {
  const f = await fixture();
  const session = await f.establish('local');
  await fs.writeFile(path.join(f.project, 'file.txt'), 'local edits\n');
  await f.workspace.archive(session.sessionId);
  const active = await f.workspace.activate(session.sessionId);
  expect(active.baseCommit).toBe(session.baseCommit);
  await f.workspace.finalize(session.sessionId, 'discarded');
  expect(await fs.readFile(path.join(f.project, 'file.txt'), 'utf8')).toBe('original\n');
});

it('rejects another repository or project scope before restoring files', async () => {
  const f = await fixture();
  const session = await f.establish('local');
  for (const identity of [{ repositoryId: 'different repository' }, { scope: 'other project' }]) {
    const other = await new RepositoryService([
      {
        id: f.backend.id,
        open: async (directory) => {
          const workspace = (await f.backend.open(directory))!;
          return { ...workspace, identity: { ...workspace.identity, ...identity } };
        },
      },
    ]).open(f.project);
    await expect(other.restore(session.baseCommit)).rejects.toMatchObject({
      code: 'invalid_revision',
    });
  }
  expect(await fs.readFile(path.join(f.project, 'file.txt'), 'utf8')).toBe('original\n');
});

it('can delete a session after its ordinary folder was removed', async () => {
  const f = await fixture();
  const workspace = new SessionWorkspace(
    f.db,
    new RepositoryService([new DirectoryBackend()]),
    f.stop,
  );
  const session = await workspace.establish('p', 'folder', {
    selectedProvider: 'provider',
    selectedModel: 'model',
  });
  await fs.rm(f.project, { recursive: true });
  await workspace.teardown(session.sessionId);
  expect(await f.db.query.sessions.findFirst()).toBeUndefined();
});

it('composes a session manager with the supplied backend catalog and no Git workspace manager', async () => {
  const f = await fixture();
  const { SessionManager } = await import('../session/manager.js');
  const manager = new SessionManager(
    f.db,
    undefined,
    {} as import('../providers/provider-registry.js').ProviderRegistry,
    { publish() {} },
    noopLogger,
    {
      startSession: async () => {
        throw new Error('Unused');
      },
      inspectProvider: async () => {
        throw new Error('Unused');
      },
    },
    undefined,
    undefined,
    f.repositories,
  );
  try {
    expect((await manager.getRepositoryService().open(f.project)).info.backendId).toBe(
      'named-history',
    );
    expect(await manager.getCheckpointService().track(f.project)).toMatch(/^revision:v1:/);
  } finally {
    await manager.stopAll();
  }
});
