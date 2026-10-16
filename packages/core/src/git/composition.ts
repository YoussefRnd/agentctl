import path from 'node:path';
import os from 'node:os';
import type { GitMutex } from './mutex.js';
import type { PullRequestHost } from '../forge/types.js';
import { GitHubPullRequests } from '../forge/github-pull-requests.js';
import { GitRepositoryQueries } from './capabilities/repository-queries.js';
import { GitWorktreeLifecycle } from './capabilities/worktree-lifecycle.js';
import { GitWorkingCopy } from './capabilities/working-copy.js';
import { GitBranchIntegration } from './capabilities/branch-integration.js';
import { GitRemoteTracking } from './capabilities/remote-tracking.js';
import { GitPullRequests } from './capabilities/pull-requests.js';
import { GitWorkspaceReview } from './capabilities/workspace-review.js';
/** One composition owns storage configuration, the mutation mutex, and each cache. */
export function createGitCapabilities(
  mutex: GitMutex,
  baseDir = path.join(os.homedir(), '.agentctl', 'worktrees'),
  host: PullRequestHost = new GitHubPullRequests(),
) {
  const storage = { baseDir };
  const queries = new GitRepositoryQueries();
  const worktrees = new GitWorktreeLifecycle(mutex, storage, queries);
  const workingCopy = new GitWorkingCopy(mutex);
  const integration = new GitBranchIntegration(mutex, storage, queries, worktrees);
  const pullRequests = new GitPullRequests(mutex, queries, host);
  const remotes = new GitRemoteTracking(mutex, queries, pullRequests);
  const review = new GitWorkspaceReview(mutex, storage);
  return {
    queries,
    worktrees,
    workingCopy,
    integration,
    pullRequests,
    remotes,
    review,
    setBaseDir(dir: string) {
      storage.baseDir = dir;
      review.reset();
    },
  };
}
export type GitCapabilities = ReturnType<typeof createGitCapabilities>;
