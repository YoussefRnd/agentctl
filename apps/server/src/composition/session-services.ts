import type { DbClient } from '@agentctl/core/db';
import type { SessionManager } from '@agentctl/core/session';
import type { WorktreeManager } from '@agentctl/core/git';
import type { ProviderRegistry } from '@agentctl/core/providers';
import type { FastifyBaseLogger } from 'fastify';
import { SessionCommands } from '../services/session-commands.js';
import { SessionQueries } from '../services/session-queries.js';
import { SessionReconciler } from '../services/session-reconciler.js';
import { SessionGitService } from '../services/session-git-service.js';
import { NativeSessionImportService } from '../services/native-session-import-service.js';

export function createSessionServices(
  db: DbClient,
  manager: SessionManager,
  workspaces: WorktreeManager,
  providers: ProviderRegistry,
  logger: FastifyBaseLogger,
  create: SessionCommands['createSession'],
) {
  return {
    commands: new SessionCommands(db, manager, providers, logger),
    queries: new SessionQueries(db, providers),
    reconciler: new SessionReconciler(db, manager, workspaces),
    git: new SessionGitService(db, manager, workspaces, providers),
    nativeImport: new NativeSessionImportService(db, manager, providers, create),
  };
}
