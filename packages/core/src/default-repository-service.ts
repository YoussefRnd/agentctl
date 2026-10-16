import type { WorkspaceManager } from './git/worktree-manager.js';
import { GitRepositoryBackend } from './git/repository-backend.js';
import type { SnapshotService } from './git/snapshot-service.js';
import { DirectoryBackend } from './repository/directory-backend.js';
import { RepositoryService } from './repository/repository-service.js';

/** Application composition: keep backend selection out of session lifecycle code. */
export function createDefaultRepositoryService(
  snapshots: SnapshotService,
  workspaces?: WorkspaceManager,
): RepositoryService {
  return new RepositoryService([
    new GitRepositoryBackend(snapshots, workspaces),
    new DirectoryBackend(),
  ]);
}
