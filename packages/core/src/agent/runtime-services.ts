import type { CredentialStore } from '../security/credential-store.js';
import type { AgentDriver } from './types.js';
import type { AgentConnectionLifecycle } from './connection-lifecycle.js';
import type { AgentDiagnosticsRecorder } from './diagnostics.js';
import type { ProviderStore } from '../providers/registry/provider-store.js';
import type { RegistryFetcher } from '../providers/registry/registry-fetcher.js';
import type { BinaryInstaller } from '../providers/registry/binary-installer.js';
import type { ProviderLauncher } from '../providers/registry/provider-launcher.js';

export interface AgentRuntimeServices {
  driver: AgentDriver;
  connections: AgentConnectionLifecycle;
  diagnostics: AgentDiagnosticsRecorder;
  providers: {
    credentials: CredentialStore;
    store: ProviderStore;
    fetcher: RegistryFetcher;
    installer: BinaryInstaller;
    launcher: ProviderLauncher;
  };
}
