import { expect, it } from 'vitest';
import { repositoryContract } from './repository.contract.js';
import { repositoryInfoSchema } from '../schemas/repository.js';

it('accepts opaque backend-independent revisions and requires a complete captured-diff request', () => {
  const query = repositoryContract.getRepositoryReview.query;
  expect(
    query.safeParse({
      fromRevision: 'revision:one',
      toRevision: 'checkpoint:two',
      filePath: 'file.txt',
    }).success,
  ).toBe(true);
  expect(query.safeParse({ fromRevision: 'revision:one' }).success).toBe(false);
  expect(
    query.safeParse({ fromRevision: 'revision:one', toRevision: 'checkpoint:two' }).success,
  ).toBe(false);
  expect(
    query.safeParse({ fromRevision: '', toRevision: 'checkpoint:two', filePath: 'file.txt' })
      .success,
  ).toBe(false);
  expect(
    query.safeParse({
      fromRevision: 'x'.repeat(8193),
      toRevision: 'checkpoint:two',
      filePath: 'file.txt',
    }).success,
  ).toBe(false);
});

it('does not restrict the backend catalog to Git', () => {
  expect(
    repositoryInfoSchema.parse({
      backendId: 'example-vcs',
      repositoryId: 'repo-17',
      workspaceId: 'workspace-9',
      workspacePath: '/project',
      rootPath: '/project',
      scope: '',
      capabilities: { review: true, checkpoints: false, comparisons: true, restore: false },
    }).backendId,
  ).toBe('example-vcs');
});
