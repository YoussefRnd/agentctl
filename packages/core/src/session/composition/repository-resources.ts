import type { RepositoryService } from '../../repository/repository-service.js';
import type { WorkspaceManager } from '../../git/worktree-manager.js';
import { SnapshotService } from '../../git/snapshot-service.js';
import { createDefaultRepositoryService } from '../../default-repository-service.js';
import type { SessionRepositoryResources } from '../contracts.js';

/** Select adapters and own the one legacy snapshot namespace during session composition. */
export function composeRepositoryResources(
  workspaces: WorkspaceManager | undefined,
  repositories?: Pick<RepositoryService, 'open'>,
): SessionRepositoryResources {
  const legacySnapshots = new SnapshotService();
  return {
    legacySnapshots,
    repositories: repositories ?? createDefaultRepositoryService(legacySnapshots, workspaces),
  };
}
