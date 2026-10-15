import { applicationInfo } from '../../config/application-info.js';
import type { AcpAgentConnection } from '../transport/client-connection.js';
import type { ClientCapabilities } from '@agentclientprotocol/sdk';
import { initializeAcpConnection } from '../v1/capabilities.js';

export async function initializeAuthConnection(
  connection: AcpAgentConnection,
  name: string,
  capabilities: ClientCapabilities = process.platform === 'win32'
    ? { elicitation: { url: {} } }
    : { auth: { terminal: true }, elicitation: { url: {} } },
) {
  const { initResult } = await initializeAcpConnection(connection, {
    clientCapabilities: capabilities,
    clientInfo: applicationInfo(name),
  });
  return initResult;
}

export function authenticateConnection(connection: AcpAgentConnection, methodId: string) {
  return connection.authenticate({ methodId });
}
