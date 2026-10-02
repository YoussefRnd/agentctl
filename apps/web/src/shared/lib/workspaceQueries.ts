import type { QueryClient } from '@tanstack/react-query';
import { projectKeys, sessionKeys } from './queryKeys';

export type WorkspaceChange = 'files' | 'git' | 'session';

/** Captured file diffs are immutable; refresh live state without invalidating them. */
export function invalidateWorkspaceQueries(
  client: QueryClient,
  sessionId?: string,
  change: WorkspaceChange = 'git',
): void {
  void client.invalidateQueries({
    queryKey: sessionId ? sessionKeys.review(sessionId) : sessionKeys.allReviews,
  });
  // A failed request has no immutable result yet and should be retryable.
  void client.invalidateQueries({
    queryKey: sessionId ? sessionKeys.reviewFiles(sessionId) : sessionKeys.allReviewFiles,
    predicate: (query) => query.state.status === 'error',
  });
  if (change !== 'files') {
    void client.invalidateQueries({
      queryKey: sessionId ? sessionKeys.gitStatus(sessionId) : sessionKeys.allGitStatuses,
    });
    void client.invalidateQueries({
      queryKey: sessionId ? sessionKeys.branches(sessionId) : sessionKeys.allBranches,
    });
  }
  if (change === 'session') {
    void client.invalidateQueries({
      queryKey: sessionId ? sessionKeys.detail(sessionId) : sessionKeys.all,
    });
    void client.invalidateQueries({ queryKey: projectKeys.all });
  }
}
