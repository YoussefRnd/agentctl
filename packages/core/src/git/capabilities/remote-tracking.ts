import { simpleGit } from 'simple-git';
import type { GitMutex } from '../mutex.js';
import type { GitRepositoryQueries } from './repository-queries.js';
import type { GitPullRequests } from './pull-requests.js';
import { trackingTarget } from './remote-target.js';
import { assertNoGitOperation, assertIgnoredFilesSafe } from './workspace-safety.js';
export class GitRemoteTracking {
  private readonly fetchedAt = new Map<string, string>();
  constructor(
    private readonly gitMutex: GitMutex,
    private readonly queries: Pick<GitRepositoryQueries, 'getCurrentBranch'>,
    private readonly pullRequests: Pick<
      GitPullRequests,
      'invalidate' | 'resolveRemote' | 'findCached'
    >,
  ) {}
  async fetch(
    repoPath: string,
    worktreePath: string,
  ): Promise<{ success: boolean; output: string }> {
    return this.gitMutex.run(repoPath, async () => {
      const { remote } = await trackingTarget(this.queries, worktreePath);
      const git = simpleGit({
        baseDir: worktreePath,
        timeout: { block: 120000, stdErr: false, stdOut: false },
      }).env('GIT_TERMINAL_PROMPT', '0');
      await git.fetch(remote, ['--prune']);
      this.fetchedAt.set(repoPath, new Date().toISOString());
      this.pullRequests.invalidate();
      return { success: true, output: `Fetched ${remote}` };
    });
  }

  async push(
    repoPath: string,
    worktreePath: string,
  ): Promise<{ success: boolean; output: string }> {
    return this.gitMutex.run(repoPath, async () => {
      const target = await trackingTarget(this.queries, worktreePath);
      const git = simpleGit({
        baseDir: worktreePath,
        timeout: { block: 120000, stdErr: false, stdOut: false },
      }).env('GIT_TERMINAL_PROMPT', '0');
      const result = await git.push([
        ...(target.configured ? [] : ['--set-upstream']),
        target.remote,
        `HEAD:${target.ref}`,
      ]);
      this.pullRequests.invalidate();
      return { success: true, output: JSON.stringify(result) };
    });
  }

  async pull(
    repoPath: string,
    worktreePath: string,
  ): Promise<{ success: boolean; output: string }> {
    return this.gitMutex.run(repoPath, async () => {
      const target = await trackingTarget(this.queries, worktreePath);
      const git = simpleGit({
        baseDir: worktreePath,
        timeout: { block: 120000, stdErr: false, stdOut: false },
      }).env('GIT_TERMINAL_PROMPT', '0');
      if (!(await git.status()).isClean())
        throw new Error('Cannot pull: worktree has uncommitted changes');
      await assertNoGitOperation(worktreePath);
      const before = (await git.revparse(['HEAD'])).trim();
      await git.fetch(target.remote, target.ref);
      this.fetchedAt.set(repoPath, new Date().toISOString());
      const remoteHead = (await git.revparse(['FETCH_HEAD'])).trim();
      const base = (await git.raw(['merge-base', before, remoteHead]).catch(() => '')).trim();
      if (remoteHead === before || base === remoteHead)
        return { success: true, output: 'Already up to date.' };
      if (base !== before)
        throw new Error(
          'Local and remote branches have diverged. Resolve the branch in a terminal before pulling.',
        );
      await assertIgnoredFilesSafe(worktreePath, remoteHead);
      await git.raw(['merge', '--ff-only', '--no-overwrite-ignore', remoteHead]);
      this.pullRequests.invalidate();
      return {
        success: true,
        output: `Updated ${before.slice(0, 7)} to ${remoteHead.slice(0, 7)}`,
      };
    });
  }

  async getTrackingStatus(
    repoPath: string,
    worktreePath: string,
  ): Promise<{
    isRepo: boolean;
    branch: string | null;
    hasPrimaryRemote: boolean;
    remoteName: string | null;
    remoteProvider: 'github' | 'other' | null;
    upstreamBranch: string | null;
    hasUpstream: boolean;
    aheadCount: number;
    behindCount: number;
    pr: {
      number: number;
      title: string;
      url: string;
      baseBranch: string;
      headBranch: string;
      state: 'open' | 'closed' | 'merged';
    } | null;
    error?: string;
    lastFetchedAt?: string | null;
  }> {
    const result = await this.gitMutex.run(repoPath, async () => {
      try {
        const git = simpleGit(worktreePath);
        const isRepo = await git.checkIsRepo();
        if (!isRepo) {
          return {
            isRepo: false,
            branch: null,
            hasPrimaryRemote: false,
            remoteName: null,
            remoteProvider: null,
            upstreamBranch: null,
            hasUpstream: false,
            aheadCount: 0,
            behindCount: 0,
            pr: null,
          };
        }

        const currentBranch = await this.queries.getCurrentBranch(worktreePath);
        const remotes = await git.getRemotes(true);
        const configuredRemote = (
          await git.raw(['config', '--get', `branch.${currentBranch}.remote`]).catch(() => '')
        ).trim();
        const primaryRemote =
          remotes.find((remote) => remote.name === configuredRemote) ??
          remotes.find((remote) => remote.name === 'origin') ??
          remotes[0];
        const remoteUrl = primaryRemote?.refs.push || primaryRemote?.refs.fetch || '';
        const hasPrimaryRemote = primaryRemote !== undefined;
        const forgeRepository = this.pullRequests.resolveRemote(remoteUrl);
        const remoteProvider = hasPrimaryRemote
          ? (forgeRepository?.provider ?? ('other' as const))
          : null;

        let upstreamBranch: string | null = null;
        let hasUpstream = false;
        let aheadCount = 0;
        let behindCount = 0;

        if (currentBranch) {
          try {
            const upstream = (await git.raw(['rev-parse', '--abbrev-ref', '@{upstream}'])).trim();
            if (upstream && !upstream.includes('@{upstream}')) {
              upstreamBranch = upstream;
              hasUpstream = true;

              const counts = (
                await git.raw(['rev-list', '--left-right', '--count', 'HEAD...@{upstream}'])
              ).trim();
              const [aheadStr, behindStr] = counts.split(/\s+/);
              aheadCount = parseInt(aheadStr, 10) || 0;
              behindCount = parseInt(behindStr, 10) || 0;
            }
          } catch {
            // No upstream branch configured
          }
        }

        const pr = null;
        const repositoryUrl = forgeRepository?.repositoryUrl;

        return {
          isRepo: true,
          branch: currentBranch,
          hasPrimaryRemote,
          remoteName: primaryRemote?.name ?? null,
          repositoryUrl,
          remoteProvider,
          upstreamBranch,
          hasUpstream,
          aheadCount,
          behindCount,
          pr,
        };
      } catch (err: unknown) {
        return {
          isRepo: false,
          branch: null,
          hasPrimaryRemote: false,
          remoteName: null,
          remoteProvider: null,
          upstreamBranch: null,
          hasUpstream: false,
          aheadCount: 0,
          behindCount: 0,
          pr: null,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    });
    // Network PR lookup runs outside the lock used by local Git mutations.
    const { repositoryUrl, ...status } = result;
    if (result.isRepo && result.branch && repositoryUrl) {
      return {
        ...status,
        pr: await this.pullRequests.findCached(
          repoPath,
          worktreePath,
          result.branch,
          repositoryUrl,
        ),
        lastFetchedAt: this.fetchedAt.get(repoPath) ?? null,
      };
    }
    return { ...status, lastFetchedAt: this.fetchedAt.get(repoPath) ?? null };
  }
}
