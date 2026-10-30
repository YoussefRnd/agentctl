import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vite-plus/test';
import { RepositoryService } from './repository-service.js';
import { RepositoryError } from './errors.js';
import { DirectoryBackend } from './directory-backend.js';
import type { RepositoryBackend, BackendWorkspace } from './types.js';

let directory: string;
beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'repository-service-'));
});

afterEach(async () => {
  await fs.rm(directory, { recursive: true, force: true });
});

it('supports backend-native revision IDs that are not Git hashes and validates ownership', async () => {
  const diff = vi.fn(async () => [
    { path: 'file.txt', state: 'modified' as const, diff: 'a patch' },
  ]);
  const compare = vi.fn(async () => ({ files: [], totalAdditions: 0, totalDeletions: 0 }));
  const textSnapshot = vi.fn(async () => ({
    listFiles: async () => ({ files: [], truncated: false }),
    readFile: async () => ({ status: 'missing' as const }),
  }));
  const backendWorkspace: BackendWorkspace = {
    identity: {
      repositoryId: 'other-repository',
      workspaceId: 'checkout-7',
      workspacePath: directory,
      rootPath: directory,
      scope: '',
    },
    resolveRevision: async (selector) => `revision/${selector}/α`,
    capture: async () => 'checkpoint/next/β',
    review: async (baseline) => ({
      files: [],
      capture: { current: 'checkpoint/next/β', working: 'revision/head/α', baseline: baseline! },
    }),
    diff,
    compare,
    textSnapshot,
  };
  const backend: RepositoryBackend = { id: 'example-vcs', open: async () => backendWorkspace };
  const otherService = new RepositoryService([backend]);
  const repository = await otherService.open(directory);
  const baseline = await repository.resolveRevision('head');
  const review = await repository.review(baseline);
  await repository.diff(baseline, review.capture!.current, 'file.txt');
  expect(diff).toHaveBeenCalledWith('revision/head/α', 'checkpoint/next/β', 'file.txt');
  const reopened = await new RepositoryService([backend]).open(directory);
  await reopened.compare(baseline, review.capture!.current);
  expect(compare).toHaveBeenCalledWith('revision/head/α', 'checkpoint/next/β');
  await reopened.textSnapshot(review.capture!.current);
  expect(textSnapshot).toHaveBeenCalledWith('checkpoint/next/β');
  expect(repository.info.capabilities.restore).toBe(false);
  await expect(repository.restore(baseline)).rejects.toMatchObject({ code: 'unsupported' });
  for (const invalid of ['HEAD', 'a'.repeat(40), 'revision:v1:bad-json', 'revision:v2:anything']) {
    await expect(repository.diff(invalid, review.capture!.current)).rejects.toBeInstanceOf(
      RepositoryError,
    );
  }
  const wrongBackend = await new RepositoryService([{ ...backend, id: 'different-vcs' }]).open(
    directory,
  );
  await expect(wrongBackend.compare(baseline, review.capture!.current)).rejects.toMatchObject({
    code: 'invalid_revision',
  });
});

it('does not hide backend failures by falling back to another implementation', async () => {
  const failure: RepositoryBackend = {
    id: 'broken',
    open: async () => {
      throw new Error('backend unavailable');
    },
  };
  const repositoryService = new RepositoryService([failure, new DirectoryBackend()]);
  await expect(repositoryService.open(directory)).rejects.toThrow('backend unavailable');
  expect(() => new RepositoryService([failure, failure])).toThrow('must be unique');
});

it('allows read-only review without requiring checkpoints, restore, or revision lookup', async () => {
  const repository = await new RepositoryService([
    {
      id: 'read-only',
      open: async (workspacePath) => ({
        identity: {
          repositoryId: 'repo',
          workspaceId: 'workspace',
          workspacePath,
          rootPath: workspacePath,
          scope: '',
        },
        review: async () => ({ files: [{ path: 'file.txt', state: 'modified', diff: 'changes' }] }),
      }),
    },
  ]).open(directory);
  expect(repository.info.capabilities).toEqual({
    review: true,
    checkpoints: false,
    comparisons: false,
    restore: false,
    isolation: false,
    integration: false,
    staging: false,
  });
  expect((await repository.review()).files[0].diff).toBe('changes');
  await expect(repository.capture()).rejects.toMatchObject({ code: 'unsupported' });
});
