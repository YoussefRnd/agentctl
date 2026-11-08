import type { ChildProcess } from 'node:child_process';
import type { AgentConnectionLifecycle } from '../../agent/connection-lifecycle.js';
import type {
  AgentMcpGateway,
  AgentSessionCallbacks,
  AgentSessionOptions,
} from '../../agent/types.js';
import type { AcpParsedCapabilities } from '../types.js';
import type { AgentStreamTransport } from './acp-process-lifecycle.js';
import type { AcpAgentConnection } from './client-connection.js';

/** Captured once: native IDs and capabilities belong to this process instance. */
export interface AcpConnectionLease {
  generation?: number;
  child: ChildProcess;
  transport: AgentStreamTransport;
  connection: AcpAgentConnection;
  capabilities: AcpParsedCapabilities;
}

export interface IConnectionManager {
  getProviderIdByCommand(command: string): string | undefined;
  getConnection(
    providerId: string,
    options?: { mcpGateway?: AgentMcpGateway },
  ): Promise<AcpConnectionLease>;
  closeSession(providerId: string, sessionId: string, lease: AcpConnectionLease): Promise<void>;
  writeTerminalInput(
    terminalId: string,
    data: string,
    lease: AcpConnectionLease,
    sessionId: string,
  ): boolean;
  registerActiveSession(
    acpSessionId: string,
    session: {
      acpSessionId: string;
      localSessionId: string;
      options: AgentSessionOptions;
      callbacks: AgentSessionCallbacks;
    },
    providerId: string,
    lease: AcpConnectionLease,
  ): void;
  unregisterActiveSession?(
    acpSessionId: string,
    providerId: string,
    lease: AcpConnectionLease,
  ): void;
}

/** Complete connection lifecycle required by the application composition root. */
export interface AgentConnectionManager extends IConnectionManager, AgentConnectionLifecycle {}

export function captureConnectionLease(connection: AcpConnectionLease): AcpConnectionLease {
  return {
    generation: connection.generation,
    child: connection.child,
    transport: connection.transport,
    connection: connection.connection,
    capabilities: { ...connection.capabilities },
  };
}

export function matchesConnectionLease(
  current: AcpConnectionLease | undefined,
  lease: AcpConnectionLease,
): boolean {
  return (
    !!current &&
    current.connection === lease.connection &&
    current.transport === lease.transport &&
    current.generation === lease.generation
  );
}
