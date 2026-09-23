import {
  PROTOCOL_VERSION,
  type ClientSideConnection,
  type ClientCapabilities,
} from '@agentclientprotocol/sdk';

export function initializeAuthConnection(
  connection: ClientSideConnection,
  name: string,
  capabilities: ClientCapabilities = process.platform === 'win32'
    ? {}
    : { auth: { terminal: true } },
) {
  return connection.initialize({
    protocolVersion: PROTOCOL_VERSION,
    clientCapabilities: capabilities,
    clientInfo: { name, title: 'Agentctl', version: '1.0.0' },
  });
}

export function authenticateConnection(connection: ClientSideConnection, methodId: string) {
  return connection.authenticate({ methodId });
}
