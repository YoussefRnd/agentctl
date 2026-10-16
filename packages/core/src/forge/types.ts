import type { GitPullRequest, CreatePullRequestResult } from '@agentctl/shared';

export interface PullRequestInput {
  title: string;
  body?: string;
  base: string;
  head: string;
}

/** Forge operations do not allocate workspaces, mutate Git, or acquire Git locks. */
export interface PullRequestHost {
  find(
    worktreePath: string,
    branch: string,
    repositoryUrl?: string,
  ): Promise<GitPullRequest | null>;
  create(
    worktreePath: string,
    repositoryUrl: string,
    input: PullRequestInput,
  ): Promise<CreatePullRequestResult>;
}
