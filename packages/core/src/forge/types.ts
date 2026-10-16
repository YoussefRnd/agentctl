import type { GitPullRequest, CreatePullRequestResult } from '@agentctl/shared';

export interface PullRequestInput {
  title: string;
  body?: string;
  base: string;
  head: string;
}

export interface ForgeRepository {
  provider: 'github';
  repositoryUrl: string;
}

/** Forge operations do not allocate workspaces, mutate Git, or acquire Git locks. */
export interface PullRequestHost {
  /** Null means this adapter cannot provide pull requests for the remote. */
  resolveRemote(remoteUrl: string): ForgeRepository | null;
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
