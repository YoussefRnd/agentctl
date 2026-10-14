import { beforeEach, expect, it, vi } from 'vitest';
import { WorkspaceManager } from './worktree-manager.js';
import { GitMutex } from './mutex.js';
const mocked = vi.hoisted(() => ({ raw: vi.fn(), push: vi.fn(), configured: false }));
vi.mock('simple-git', () => ({
  simpleGit: () => {
    const git = {
      env: () => git,
      raw: mocked.raw,
      status: async () => ({ isClean: () => true }),
      getRemotes: async () => [
        {
          name: 'origin',
          refs: {
            push: 'https://github.com/example/project.git',
            fetch: 'https://github.com/example/project.git',
          },
        },
      ],
      push: mocked.push,
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
  mocked.push.mockReset().mockResolvedValue({});
  mocked.raw.mockReset().mockImplementation(async (args: string[]) => {
    if (args[0] === 'symbolic-ref') return 'feature';
    if (args[0] === 'check-ref-format') return '';
    if (args[0] === 'rev-parse') return '/nonexistent-agentctl-pr-fixture/' + args[2];
    if (args[0] === 'config')
      return mocked.configured ? (args[2].endsWith('.remote') ? 'origin' : 'refs/heads/trunk') : '';
    throw new Error('Unexpected Git command: ' + args.join(' '));
  });
});
it.each([false, true])(
  'sets upstream only when the branch has no configured tracking: %s',
  async (configured) => {
    mocked.configured = configured;
    const manager = new WorkspaceManager(new GitMutex(), '/tmp');
    vi.spyOn(manager, 'detectPullRequest').mockResolvedValue({
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
  const manager = new WorkspaceManager(new GitMutex(), '/tmp');
  vi.spyOn(manager, 'detectPullRequest').mockResolvedValue({
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
