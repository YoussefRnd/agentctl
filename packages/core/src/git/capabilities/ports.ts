import type { GitRepositoryQueries } from './repository-queries.js';
import type { GitWorktreeLifecycle } from './worktree-lifecycle.js';
import type { GitWorkingCopy } from './working-copy.js';
import type { GitBranchIntegration } from './branch-integration.js';
import type { GitRemoteTracking } from './remote-tracking.js';
import type { GitPullRequests } from './pull-requests.js';
import type { GitWorkspaceReview } from './workspace-review.js';

/** Structural ports contain operations, without implementation state or constructors. */
export type GitRepositoryAccess = Pick<GitRepositoryQueries, keyof GitRepositoryQueries>;
export type GitWorktreeOperations = Pick<
  GitWorktreeLifecycle,
  Exclude<keyof GitWorktreeLifecycle, 'listWorktrees'>
>;
export type GitWorkingCopyOperations = Pick<
  GitWorkingCopy,
  Exclude<keyof GitWorkingCopy, 'unstagePaths'>
>;
export type GitBranchOperations = Pick<GitBranchIntegration, keyof GitBranchIntegration>;
export type GitRemoteOperations = Pick<GitRemoteTracking, keyof GitRemoteTracking>;
export type GitPullRequestOperations = Pick<
  GitPullRequests,
  'detectPullRequest' | 'createPullRequest'
>;
export type GitReviewOperations = Pick<GitWorkspaceReview, 'getDiff' | 'getReviewFiles'>;
