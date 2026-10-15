import type { ChildProcess } from 'node:child_process';
import type { AcpParsedCapabilities, AgentStreamTransport } from '../types.js';
import type { AcpAgentConnection } from './client-connection.js';

/** Captured once: native IDs and capabilities belong to this process instance. */
export interface AcpConnectionLease {
  generation?: number;
  child: ChildProcess;
  transport: AgentStreamTransport;
  connection: AcpAgentConnection;
  capabilities: AcpParsedCapabilities;
}

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
