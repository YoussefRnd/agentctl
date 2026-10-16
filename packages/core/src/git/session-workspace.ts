import type { DbClient } from '../db/index.js';
import type { WorkspaceManager } from './worktree-manager.js';
import { SnapshotService } from './snapshot-service.js';
import { createDefaultRepositoryService } from '../default-repository-service.js';
import { SessionWorkspace as RepositorySessionWorkspace } from '../workspace/session-workspace.js';
export * from '../workspace/session-workspace.js';

/** Compatibility construction for the historical Git entry point. New composition supplies repositories. */
export class SessionWorkspace extends RepositorySessionWorkspace {
  constructor(
    db: DbClient,
    workspaces: WorkspaceManager,
    stop: (id: string) => Promise<void> | void,
    snapshots?: () => SnapshotService,
    event?: (type: string, payload: Record<string, unknown>) => void,
  ) {
    let defaults: SnapshotService | undefined;
    super(
      db,
      {
        open: (path) =>
          createDefaultRepositoryService(
            snapshots?.() ?? (defaults ??= new SnapshotService()),
            workspaces,
          ).open(path),
      },
      stop,
      event,
    );
  }
}
