import { composeRepositoryResources } from './repository-resources.js';
import type { RepositoryService } from '../../repository/repository-service.js';
import type { DbClient } from '../../db/index.js';
import type { Logger } from '../../logger.js';
import type { AgentDriver, AgentMcpGateway } from '../../agent/types.js';
import type { AgentRuntimeServices } from '../../agent/runtime-services.js';
import { createDefaultAgentDriver } from '../../default-agent-driver.js';
import type { WorkspaceManager } from '../../git/worktree-manager.js';
import { SessionWorkspace } from '../../workspace/session-workspace.js';
import type { ProviderRegistry } from '../../providers/provider-registry.js';
import type { IEventBus } from '../contracts.js';
import { SessionEventRepository } from '../persistence/session-event-repository.js';
import { SessionRuntimeRegistry } from '../runtime/session-runtime-registry.js';

/** The default transport and concrete session resources are selected only here. */
export function composeSessionResources(
  db: DbClient,
  workspaceManager: WorkspaceManager | undefined,
  providerRegistry: ProviderRegistry,
  eventBus: IEventBus,
  logger: Logger,
  suppliedDriver?: AgentDriver,
  mcpGateway?: AgentMcpGateway,
  runtimeServices?: AgentRuntimeServices,
  repositories?: Pick<RepositoryService, 'open'>,
) {
  const runtime = runtimeServices?.driver ?? suppliedDriver ?? createDefaultAgentDriver(logger);
  if (!runtimeServices) {
    const connectionAwareRuntime = runtime as AgentDriver & {
      setConnectionManager?: (manager: unknown) => void;
    };
    connectionAwareRuntime.setConnectionManager?.(providerRegistry.getConnectionManager());
  }
  const eventRepository = new SessionEventRepository(db, eventBus);
  const runtimeRegistry = new SessionRuntimeRegistry(
    db,
    providerRegistry,
    eventRepository,
    logger,
    runtime,
    composeRepositoryResources(workspaceManager, repositories),
    mcpGateway,
  );
  const sessionWorkspace = new SessionWorkspace(
    db,
    runtimeRegistry.getRepositoryService(),
    (sessionId) => runtimeRegistry.stopSessionAndWait(sessionId),
  );
  return { runtime, eventRepository, runtimeRegistry, sessionWorkspace };
}
