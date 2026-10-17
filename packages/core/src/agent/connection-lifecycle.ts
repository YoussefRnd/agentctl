import type { AgentConnectionDiagnostic } from './diagnostics.js';

/** Application ownership of shared connections, independent of a wire protocol. */
export interface AgentConnectionLifecycle {
  getConnectionDiagnostics(): AgentConnectionDiagnostic[];
  closeConnection(providerId: string): void;
  closeAll(): void;
  /** Final shutdown; reject future connections and await owned cleanup. */
  dispose?(): Promise<void>;
}
