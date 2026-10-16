import { repositoryIdentity } from './identity.js';
import type { RepositoryBackend, BackendWorkspace } from './types.js';

/** Ordinary folders are usable workspaces, without claiming history or recovery support. */
export class DirectoryBackend implements RepositoryBackend {
  readonly id = 'directory';

  async open(workspacePath: string): Promise<BackendWorkspace> {
    const identity = repositoryIdentity(this.id, workspacePath);
    return {
      identity: {
        repositoryId: identity,
        workspaceId: identity,
        rootPath: workspacePath,
        workspacePath,
        scope: '',
      },
    };
  }
}
