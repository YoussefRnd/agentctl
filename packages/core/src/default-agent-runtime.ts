import { getDefaultCredentialVault } from './default-credential-vault.js';
import type { CredentialStore } from './security/credential-store.js';
import { spawn } from 'node:child_process';
import type { AgentDriver } from './agent/types.js';
import { AcpAgentDriver } from './acp/driver.js';
import { PersistentAgentConnectionManager } from './acp/transport/persistent-connection.js';
import { AgentDiagnosticsRecorder } from './agent/diagnostics.js';
import type { Logger } from './logger.js';
import type { DbClient } from './db/index.js';
import { ProviderStore } from './providers/registry/provider-store.js';
import { RegistryFetcher } from './providers/registry/registry-fetcher.js';
import { BinaryInstaller } from './providers/registry/binary-installer.js';
import { ProviderLauncher } from './providers/registry/provider-launcher.js';

import type { AgentRuntimeServices } from './agent/runtime-services.js';

export interface CreateAgentRuntimeServicesOptions {
  db?: DbClient;
  credentials?: CredentialStore;
  driver?: AgentDriver;
  store?: ProviderStore;
  fetcher?: RegistryFetcher;
  installer?: BinaryInstaller;
  launcher?: ProviderLauncher;
  logger: Logger;
  diagnostics?: AgentDiagnosticsRecorder;
  spawnImpl?: typeof spawn;
}

export function createAgentRuntimeServices(
  options: CreateAgentRuntimeServicesOptions,
): AgentRuntimeServices {
  const diagnostics = options.diagnostics ?? new AgentDiagnosticsRecorder();
  const db = options.db;

  const store = options.store ?? (db ? new ProviderStore(db) : undefined);
  if (!store) {
    throw new Error('Either db or store must be provided to createAgentRuntimeServices');
  }

  if (!options.fetcher && !db) {
    throw new Error('Either db or fetcher must be provided to createAgentRuntimeServices');
  }
  const fetcher = options.fetcher ?? new RegistryFetcher(db!, options.logger);
  const installer = options.installer ?? new BinaryInstaller();
  const credentials = options.credentials ?? getDefaultCredentialVault();
  const launcher =
    options.launcher ?? new ProviderLauncher(store, installer, credentials, options.logger);

  const connections = new PersistentAgentConnectionManager(
    store,
    fetcher,
    launcher,
    options.logger,
    diagnostics,
  );

  const driver =
    options.driver ??
    AcpAgentDriver.create(options.spawnImpl ?? spawn, options.logger, diagnostics);
  if (!options.driver) (driver as AcpAgentDriver).setConnectionManager(connections);

  return {
    driver,
    connections,
    diagnostics,
    providers: { store, fetcher, installer, launcher, credentials },
  };
}
