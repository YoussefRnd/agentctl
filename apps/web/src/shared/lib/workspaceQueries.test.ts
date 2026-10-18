import { QueryClient } from '@tanstack/react-query';
import { expect, it } from 'vite-plus/test';
import { sessionKeys, projectKeys } from './queryKeys';
import { invalidateWorkspaceQueries } from './workspaceQueries';

it('refreshes live workspace state while preserving captured diffs and unrelated sessions', () => {
  const client = new QueryClient();
  const summary = sessionKeys.review('one');
  const immutable = sessionKeys.reviewFile('one', 'file.txt', 'before', 'after');
  const unrelated = sessionKeys.review('two');
  const git = sessionKeys.gitStatus('one');
  const branches = sessionKeys.branches('one');
  for (const key of [summary, immutable, unrelated, git, branches]) client.setQueryData(key, {});
  invalidateWorkspaceQueries(client, 'one');
  for (const key of [summary, git, branches])
    expect(client.getQueryState(key)?.isInvalidated).toBe(true);
  for (const key of [immutable, unrelated])
    expect(client.getQueryState(key)?.isInvalidated).toBe(false);
  client.clear();
});

it('refreshes only the summary for staging and includes session metadata for workspace transitions', () => {
  const client = new QueryClient();
  const keys = [
    sessionKeys.review('one'),
    sessionKeys.gitStatus('one'),
    sessionKeys.branches('one'),
    sessionKeys.detail('one'),
    projectKeys.all,
  ];
  for (const key of keys) client.setQueryData(key, {});
  invalidateWorkspaceQueries(client, 'one', 'files');
  expect(client.getQueryState(keys[0])?.isInvalidated).toBe(true);
  for (const key of keys.slice(1)) expect(client.getQueryState(key)?.isInvalidated).toBe(false);
  invalidateWorkspaceQueries(client, 'one', 'session');
  for (const key of keys) expect(client.getQueryState(key)?.isInvalidated).toBe(true);
  client.clear();
});

it('global synchronization refreshes summaries without invalidating any captured diffs', () => {
  const client = new QueryClient();
  const summaries = ['one', 'two'].map(sessionKeys.review);
  const details = ['one', 'two'].map((id) =>
    sessionKeys.reviewFile(id, 'file.txt', 'before', 'after'),
  );
  for (const key of [...summaries, ...details]) client.setQueryData(key, {});
  invalidateWorkspaceQueries(client);
  for (const key of summaries) expect(client.getQueryState(key)?.isInvalidated).toBe(true);
  for (const key of details) expect(client.getQueryState(key)?.isInvalidated).toBe(false);
  client.clear();
});

it('makes failed file requests retryable without discarding successful captured patches', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const failed = sessionKeys.reviewFile('one', 'failed.txt', 'before', 'after');
  const successful = sessionKeys.reviewFile('one', 'loaded.txt', 'before', 'after');
  client.setQueryData(successful, { diff: 'captured' });
  await expect(
    client.fetchQuery({
      queryKey: failed,
      queryFn: () => {
        throw new Error('temporary failure');
      },
    }),
  ).rejects.toThrow('temporary failure');
  invalidateWorkspaceQueries(client, 'one');
  expect(client.getQueryState(failed)?.isInvalidated).toBe(true);
  expect(client.getQueryState(successful)?.isInvalidated).toBe(false);
  client.clear();
});
