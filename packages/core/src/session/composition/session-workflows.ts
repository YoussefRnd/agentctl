import type { DbClient } from '../../db/index.js';
import type { Logger } from '../../logger.js';
import type { AgentDriver } from '../../agent/types.js';
import type { ProviderRegistry } from '../../providers/provider-registry.js';
import type { SessionWorkspace } from '../../workspace/session-workspace.js';
import type { SessionEventRepository } from '../persistence/session-event-repository.js';
import type { SessionRuntimeRegistry } from '../runtime/session-runtime-registry.js';
import { SessionLauncher } from '../services/session-launcher.js';
import { SessionLifecycleService } from '../services/session-lifecycle-service.js';
import { SessionHistoryService } from '../services/session-history-service.js';
import { SessionCommandHandler } from '../commands/session-command-handler.js';

export interface SessionWorkflowResources {
  readonly db: DbClient;
  readonly logger: Logger;
  readonly runtime: AgentDriver;
  readonly providerRegistry: ProviderRegistry;
  readonly eventRepository: SessionEventRepository;
  readonly runtimeRegistry: SessionRuntimeRegistry;
  readonly sessionWorkspace: SessionWorkspace;
}
export interface SessionWorkflowDelegates {
  startSession: SessionLauncher['startSession'];
  restartSession: SessionLauncher['restartSession'];
  getOrResuscitate: SessionLauncher['getOrResuscitate'];
  createForkSession: SessionHistoryService['createForkSession'];
}

/** Compose workflows without routing internal operations back through command lanes. */
export function composeSessionWorkflows(
  resources: SessionWorkflowResources,
  delegates: SessionWorkflowDelegates,
) {
  const launcher = new SessionLauncher({
    get eventRepository() {
      return resources.eventRepository;
    },
    get db() {
      return resources.db;
    },
    get logger() {
      return resources.logger;
    },
    get runtimeRegistry() {
      return resources.runtimeRegistry;
    },
    get sessionWorkspace() {
      return resources.sessionWorkspace;
    },
    get providerRegistry() {
      return resources.providerRegistry;
    },
    startSession: (...args) => delegates.startSession(...args),
    restartSession: (...args) => delegates.restartSession(...args),
  });
  const lifecycle = new SessionLifecycleService({
    get db() {
      return resources.db;
    },
    get logger() {
      return resources.logger;
    },
    get runtimeRegistry() {
      return resources.runtimeRegistry;
    },
    get sessionWorkspace() {
      return resources.sessionWorkspace;
    },
    get runtime() {
      return resources.runtime;
    },
    launcher,
    restartSession: (...args) => delegates.restartSession(...args),
  });
  const history = new SessionHistoryService({
    get db() {
      return resources.db;
    },
    get logger() {
      return resources.logger;
    },
    get runtimeRegistry() {
      return resources.runtimeRegistry;
    },
    get sessionWorkspace() {
      return resources.sessionWorkspace;
    },
    get eventRepository() {
      return resources.eventRepository;
    },
    launcher,
    startSession: (...args) => delegates.startSession(...args),
    restartSession: (...args) => delegates.restartSession(...args),
    createForkSession: (...args) => delegates.createForkSession(...args),
  });
  const commandHandler = new SessionCommandHandler({
    get db() {
      return resources.db;
    },
    get logger() {
      return resources.logger;
    },
    get runtimeRegistry() {
      return resources.runtimeRegistry;
    },
    get providerRegistry() {
      return resources.providerRegistry;
    },
    get eventRepository() {
      return resources.eventRepository;
    },
    launcher,
    restartSession: (...args) => delegates.restartSession(...args),
    getOrResuscitate: (...args) => delegates.getOrResuscitate(...args),
    switchMode: (...args) => lifecycle.switchMode(...args),
    rewindSession: (...args) => history.rewindSession(...args),
    clearRewindBackup: (...args) => history.clearRewindBackup(...args),
  });
  return { launcher, lifecycle, history, commandHandler };
}
