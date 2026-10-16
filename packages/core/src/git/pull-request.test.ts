import { beforeEach, expect, it, vi } from 'vitest';
import { WorkspaceManager } from './worktree-manager.js';
import { GitMutex } from './mutex.js';
import { GitHubPullRequests } from '../forge/github-pull-requests.js';
const mocked = vi.hoisted(() => ({
  raw: vi.fn(),
  push: vi.fn(),
  fetch: vi.fn(),
  configured: false,
  remoteUrl: 'https://github.com/example/project.git',
}));
vi.mock('simple-git', () => ({
  simpleGit: () => {
    const git = {
      env: () => git,
      raw: mocked.raw,
      checkIsRepo: async () => true,
      status: async () => ({ isClean: () => true }),
      getRemotes: async () => [
        {
          name: 'origin',
          refs: {
            push: mocked.remoteUrl,
            fetch: mocked.remoteUrl,
          },
        },
      ],
      push: mocked.push,
      fetch: mocked.fetch,
    };
    return git;
  },
}));
vi.mock('node:child_process', async (original) => ({
  ...(await original<object>()),
  execFile: (
    _command: string,
    _args: string[],
    _options: unknown,
    callback: (error: Error) => void,
  ) => {
    callback(new Error('GitHub CLI unavailable in this fixture'));
  },
}));
beforeEach(() => {
  mocked.configured = false;
  mocked.remoteUrl = 'https://github.com/example/project.git';
  mocked.push.mockReset().mockResolvedValue({});
  mocked.fetch.mockReset().mockResolvedValue({});
  mocked.raw.mockReset().mockImplementation(async (args: string[]) => {
    if (args[0] === 'symbolic-ref') return 'feature';
    if (args[0] === 'check-ref-format') return '';
    if (args[0] === 'rev-parse') return '/nonexistent-agentctl-pr-fixture/' + args[2];
    if (args[0] === 'config')
      return mocked.configured ? (args[2].endsWith('.remote') ? 'origin' : 'refs/heads/trunk') : '';
    throw new Error('Unexpected Git command: ' + args.join(' '));
  });
});

it('releases the mutation lock before waiting for a forge to find or create a PR', async () => {
  const mutex = new GitMutex();
  const host = new GitHubPullRequests();
  const found = Promise.withResolvers<null>();
  const created = Promise.withResolvers<Awaited<ReturnType<typeof host.create>>>();
  const find = vi.spyOn(host, 'find').mockReturnValue(found.promise);
  const create = vi.spyOn(host, 'create').mockReturnValue(created.promise);
  const manager = new WorkspaceManager(mutex, '/tmp', host);
  const publishing = manager.createPullRequest('/repo', '/worktree', {
    title: 'Reviewed draft',
    baseBranch: 'main',
  });
  try {
    await vi.waitFor(() => expect(find).toHaveBeenCalledOnce());
    await expect(mutex.run('/repo', () => 'available during lookup')).resolves.toBe(
      'available during lookup',
    );
    found.resolve(null);
    await vi.waitFor(() => expect(create).toHaveBeenCalledOnce());
    await expect(mutex.run('/repo', () => 'available during creation')).resolves.toBe(
      'available during creation',
    );
  } finally {
    found.resolve(null);
    created.resolve({ status: 'needs_browser', compareUrl: 'https://github.com/example/project' });
    await publishing;
  }
});

it('uses the injected forge to interpret remotes before publishing', async () => {
  mocked.remoteUrl = 'ssh://forge.example/project';
  const host = new GitHubPullRequests();
  vi.spyOn(host, 'resolveRemote').mockReturnValue({
    provider: 'github',
    repositoryUrl: 'https://forge.example/project',
  });
  vi.spyOn(host, 'find').mockResolvedValue(null);
  const create = vi.spyOn(host, 'create').mockResolvedValue({
    status: 'needs_browser',
    compareUrl: 'https://forge.example/project/compare',
  });
  const manager = new WorkspaceManager(new GitMutex(), '/tmp', host);
  await manager.createPullRequest('/repo', '/worktree', {
    title: 'Reviewed draft',
    baseBranch: 'main',
  });
  expect(create).toHaveBeenCalledWith('/worktree', 'https://forge.example/project', {
    title: 'Reviewed draft',
    body: undefined,
    base: 'main',
    head: 'feature',
  });
});

it('rejects unsupported remotes before pushing and skips their PR lookup', async () => {
  mocked.remoteUrl = 'https://gitlab.com/example/project.git';
  const host = new GitHubPullRequests();
  const find = vi.spyOn(host, 'find');
  const manager = new WorkspaceManager(new GitMutex(), '/tmp', host);
  await expect(
    manager.createPullRequest('/repo', '/worktree', { title: 'Draft', baseBranch: 'main' }),
  ).rejects.toThrow('unsupported for this remote');
  expect(await manager.detectPullRequest('/worktree')).toBeNull();
  expect(await manager.getTrackingStatus('/repo', '/worktree')).toMatchObject({
    isRepo: true,
    remoteProvider: 'other',
    pr: null,
  });
  expect(mocked.push).not.toHaveBeenCalled();
  expect(find).not.toHaveBeenCalled();
});

it('shares in-flight PR lookups and invalidates them after a fetch', async () => {
  const mutex = new GitMutex();
  const host = new GitHubPullRequests();
  const found = Promise.withResolvers<null>();
  const find = vi.spyOn(host, 'find').mockReturnValue(found.promise);
  const manager = new WorkspaceManager(mutex, '/tmp', host);
  const first = manager.getTrackingStatus('/repo', '/worktree');
  const second = manager.capabilities.remotes.getTrackingStatus('/repo', '/worktree');
  try {
    await vi.waitFor(() => expect(find).toHaveBeenCalledOnce());
    await expect(mutex.run('/repo', () => 'available')).resolves.toBe('available');
  } finally {
    found.resolve(null);
    await Promise.all([first, second]);
  }
  expect(find).toHaveBeenCalledOnce();
  await manager.capabilities.remotes.fetch('/repo', '/worktree');
  expect(await manager.getTrackingStatus('/repo', '/worktree')).toMatchObject({
    lastFetchedAt: expect.any(String),
  });
  expect(find).toHaveBeenCalledTimes(2);
});

it('does not report a failed fetch as a successful refresh', async () => {
  const host = new GitHubPullRequests();
  vi.spyOn(host, 'find').mockResolvedValue(null);
  const manager = new WorkspaceManager(new GitMutex(), '/tmp', host);
  mocked.fetch.mockRejectedValue(new Error('Remote unavailable'));
  await expect(manager.fetch('/repo', '/worktree')).rejects.toThrow('Remote unavailable');
  expect(await manager.getTrackingStatus('/repo', '/worktree')).toMatchObject({
    isRepo: true,
    lastFetchedAt: null,
  });
});

it('serializes mutations from the facade and focused capabilities with one mutex', async () => {
  const mutex = new GitMutex();
  const manager = new WorkspaceManager(mutex, '/tmp');
  const gate = Promise.withResolvers<void>();
  const locked = mutex.run('/repo', () => gate.promise);
  const staging = manager.capabilities.workingCopy.stageAll('/repo', '/worktree');
  const fetching = manager.fetch('/repo', '/worktree');
  try {
    await Promise.resolve();
    expect(mocked.raw).not.toHaveBeenCalled();
    expect(mocked.fetch).not.toHaveBeenCalled();
    mocked.raw.mockImplementation(async (args: string[]) => {
      if (args[0] === 'add') return '';
      if (args[0] === 'symbolic-ref') return 'feature';
      if (args[0] === 'config') return '';
      throw new Error('Unexpected command');
    });
  } finally {
    gate.resolve();
    await Promise.all([locked, staging, fetching]);
  }
  expect(mocked.fetch).toHaveBeenCalledOnce();
  expect(mocked.raw.mock.calls[0][0]).toEqual(['add', '-A', '--', '.']);
});
it.each([false, true])(
  'sets upstream only when the branch has no configured tracking: %s',
  async (configured) => {
    mocked.configured = configured;
    const host = new GitHubPullRequests();
    const manager = new WorkspaceManager(new GitMutex(), '/tmp', host);
    vi.spyOn(host, 'find').mockResolvedValue({
      number: 1,
      title: 'Existing',
      url: 'https://github.com/example/project/pull/1',
      headBranch: 'feature',
      baseBranch: 'main',
      state: 'open',
    });
    const result = await manager.createPullRequest('/repo', '/worktree', {
      title: 'Reviewed draft',
      baseBranch: 'main',
    });
    expect(result.status).toBe('already_exists');
    expect(mocked.push).toHaveBeenCalledExactlyOnceWith([
      ...(configured ? [] : ['--set-upstream']),
      'origin',
      'refs/heads/feature:refs/heads/feature',
    ]);
  },
);

it('does not return an existing PR against a different destination', async () => {
  mocked.configured = false;
  const host = new GitHubPullRequests();
  const manager = new WorkspaceManager(new GitMutex(), '/tmp', host);
  vi.spyOn(host, 'find').mockResolvedValue({
    number: 1,
    title: 'Existing',
    url: 'https://github.com/example/project/pull/1',
    headBranch: 'feature',
    baseBranch: 'main',
    state: 'open',
  });
  const result = await manager.createPullRequest('/repo', '/worktree', {
    title: 'Reviewed draft',
    baseBranch: 'develop',
  });
  expect(result.status).toBe('needs_browser');
  if (result.status === 'needs_browser')
    expect(result.compareUrl).toContain('/compare/develop...feature?');
});
