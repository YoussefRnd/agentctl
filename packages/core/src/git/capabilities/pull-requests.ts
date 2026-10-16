import { simpleGit } from 'simple-git';
import type { GitPullRequest } from '@agentctl/shared';
import type { PullRequestHost } from '../../forge/types.js';
import type { GitMutex } from '../mutex.js';
import type { GitRepositoryQueries } from './repository-queries.js';
import { trackingTarget } from './remote-target.js';
import { assertNoGitOperation } from './workspace-safety.js';
export class GitPullRequests {
  private readonly cache = new Map<
    string,
    { expiresAt: number; value: Promise<GitPullRequest | null> }
  >();
  constructor(
    private readonly gitMutex: GitMutex,
    private readonly queries: Pick<GitRepositoryQueries, 'getCurrentBranch'>,
    private readonly pullRequests: PullRequestHost,
  ) {}
  resolveRemote(remoteUrl: string) {
    return this.pullRequests.resolveRemote(remoteUrl);
  }
  invalidate(): void {
    this.cache.clear();
  }
  findCached(
    repoPath: string,
    worktreePath: string,
    branch: string,
    repositoryUrl: string,
  ): Promise<GitPullRequest | null> {
    const key = JSON.stringify([repoPath, branch, repositoryUrl]);
    let cached = this.cache.get(key);
    if (!cached || cached.expiresAt < Date.now()) {
      if (this.cache.size >= 100) this.cache.clear();
      cached = {
        expiresAt: Date.now() + 60000,
        value: this.detectPullRequest(worktreePath, branch, repositoryUrl),
      };
      this.cache.set(key, cached);
    }
    return cached.value;
  }
  async detectPullRequest(
    worktreePath: string,
    branchName?: string,
    repositoryUrl?: string,
  ): Promise<{
    number: number;
    title: string;
    url: string;
    baseBranch: string;
    headBranch: string;
    state: 'open' | 'closed' | 'merged';
  } | null> {
    try {
      const branch = branchName ?? (await this.queries.getCurrentBranch(worktreePath));
      if (!branch || branch === 'HEAD') return null;
      if (!repositoryUrl) {
        const target = await trackingTarget(this.queries, worktreePath);
        const remotes = await simpleGit(worktreePath).getRemotes(true);
        const remote = remotes.find((candidate) => candidate.name === target.remote);
        repositoryUrl = this.resolveRemote(
          remote?.refs.push || remote?.refs.fetch || '',
        )?.repositoryUrl;
      }
      if (!repositoryUrl || !this.resolveRemote(repositoryUrl)) return null;
      return await this.pullRequests.find(worktreePath, branch, repositoryUrl);
    } catch {
      return null;
    }
  }

  async createPullRequest(
    repoPath: string,
    worktreePath: string,
    params: {
      title: string;
      body?: string;
      baseBranch?: string;
      headBranch?: string;
    },
  ): Promise<
    | {
        status: 'created' | 'already_exists';
        pr: {
          number: number;
          title: string;
          url: string;
          baseBranch: string;
          headBranch: string;
          state: 'open' | 'closed' | 'merged';
        };
      }
    | {
        status: 'needs_browser';
        compareUrl: string;
      }
  > {
    const publication = await this.gitMutex.run(repoPath, async () => {
      const git = simpleGit({
        baseDir: worktreePath,
        timeout: { block: 120000, stdErr: false, stdOut: false },
      }).env('GIT_TERMINAL_PROMPT', '0');
      const currentBranch = await this.queries.getCurrentBranch(worktreePath);
      const head = params.headBranch ?? currentBranch;
      if (head !== currentBranch)
        throw new Error(
          'The workspace branch changed. Refresh and review the current branch before publishing.',
        );
      const base = (
        params.baseBranch ??
        (await this.queries.getCurrentBranch(repoPath)) ??
        'main'
      ).trim();

      if (!head || head === 'HEAD') {
        throw new Error('Cannot create a pull request from a detached HEAD');
      }
      if (!base.trim()) {
        throw new Error('A base branch is required');
      }
      if (head === base) {
        throw new Error('The head and base branches must be different');
      }

      await git.raw(['check-ref-format', '--branch', head]);
      await git.raw(['check-ref-format', '--branch', base]);
      await assertNoGitOperation(worktreePath);

      const worktreeStatus = await git.status();
      if (!worktreeStatus.isClean()) {
        throw new Error(
          'Commit or discard all working tree changes before creating a pull request',
        );
      }

      const remotes = await git.getRemotes(true);
      const target = await trackingTarget(this.queries, worktreePath);
      const primaryRemote = remotes.find((remote) => remote.name === target.remote);
      if (!primaryRemote) {
        throw new Error('No Git remote is configured for this repository');
      }
      const remoteUrl = primaryRemote.refs.push || primaryRemote.refs.fetch || '';
      const repoWebUrl = this.pullRequests.resolveRemote(remoteUrl)?.repositoryUrl;
      if (!repoWebUrl) {
        throw new Error('Pull request creation is unsupported for this remote');
      }

      await git.push([
        ...(target.configured ? [] : ['--set-upstream']),
        primaryRemote.name,
        `refs/heads/${head}:refs/heads/${head}`,
      ]);
      this.invalidate();

      return { head, base, repoWebUrl };
    });
    const { head, base, repoWebUrl } = publication;
    const existingPr = await this.detectPullRequest(worktreePath, head, repoWebUrl);
    if (existingPr?.state === 'open' && existingPr.baseBranch === base) {
      return { status: 'already_exists', pr: existingPr };
    }

    return this.pullRequests.create(worktreePath, repoWebUrl, {
      title: params.title,
      body: params.body,
      base,
      head,
    });
  }
}
