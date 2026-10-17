import { spawn } from 'node:child_process';
import { AcpAgentDriver } from './acp/driver.js';
import { PersistentAgentConnectionManager } from './acp/transport/persistent-connection.js';
import { AgentDiagnosticsRecorder } from './agent/diagnostics.js';
import type { Logger } from './logger.js';
import type { ProviderStore } from './providers/registry/provider-store.js';
import type { RegistryFetcher } from './providers/registry/registry-fetcher.js';
import type { ProviderLauncher } from './providers/registry/provider-launcher.js';

/** Composition helper for applications that use ACP as their configured transport. */
export function createDefaultAgentDriver(
  logger: Logger,
  diagnostics: AgentDiagnosticsRecorder = new AgentDiagnosticsRecorder(),
) {
  return AcpAgentDriver.create(spawn, logger, diagnostics);
}

/** Composition helper for the default transport's shared process manager. */
export function createDefaultAgentConnectionManager(
  store: ProviderStore,
  fetcher: RegistryFetcher,
  launcher: ProviderLauncher,
  logger: Logger,
  diagnostics: AgentDiagnosticsRecorder = new AgentDiagnosticsRecorder(),
) {
  return new PersistentAgentConnectionManager(store, fetcher, launcher, logger, diagnostics);
}
