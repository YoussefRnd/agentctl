import { api, assertApiStatus } from '@agentctl/api-client';
import type { RepositoryReview } from '@agentctl/shared';

/** Normalize the wire representation once before it enters session state. */
export async function fetchWorkspaceReview(sessionId: string): Promise<RepositoryReview> {
  const response = await api.getRepositoryReview({
    params: { id: sessionId },
    query: { includeDiffs: 'false', scope: 'working' },
  });
  assertApiStatus(response, 200, 'Failed to fetch session review');
  return {
    repository: response.body.repository,
    capture: response.body.capture,
    files: response.body.files.map((file) => ({ ...file, diff: file.diff ?? '' })),
  };
}
