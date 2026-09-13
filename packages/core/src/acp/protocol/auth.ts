import { PROTOCOL_VERSION, type ClientSideConnection } from '@agentclientprotocol/sdk';

export function initializeAuthConnection(connection: ClientSideConnection, name: string) {
  return connection.initialize({
    protocolVersion: PROTOCOL_VERSION,
    clientCapabilities: {},
    clientInfo: { name, title: 'Agentctl', version: '1.0.0' },
  });
}

export function authenticateConnection(
  connection: ClientSideConnection,
  methodId: string,
  params: Record<string, unknown>,
) {
  return connection.authenticate(
    Object.keys(params).length > 0 ? { methodId, _meta: params } : { methodId },
  );
}
