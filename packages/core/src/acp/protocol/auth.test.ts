import { describe, it, expect, vi } from 'vitest';
import { initializeAuthConnection, authenticateConnection } from './auth.js';
import { PROTOCOL_VERSION, type ClientSideConnection } from '@agentclientprotocol/sdk';
import { AGENTCTL_CLIENT_CAPABILITIES } from '../transport/capabilities-cache.js';

describe('ACP Protocol Auth Conformance', () => {
  it('advertises auth.terminal capability in default client capabilities', () => {
    expect(AGENTCTL_CLIENT_CAPABILITIES.auth).toEqual({ terminal: true });
  });

  it('initializeAuthConnection sends protocol version and client capabilities advertising terminal auth', async () => {
    const mockInitialize = vi.fn().mockResolvedValue({
      protocolVersion: PROTOCOL_VERSION,
      agentCapabilities: {},
      authMethods: [
        { id: 'web', name: 'Web Login', type: 'agent' },
        { id: 'cli', name: 'CLI Login', type: 'terminal', args: ['login'] },
      ],
    });

    const connection = {
      initialize: mockInitialize,
    } as unknown as ClientSideConnection;

    const res = await initializeAuthConnection(connection, 'test-agent');

    expect(mockInitialize).toHaveBeenCalledWith({
      protocolVersion: PROTOCOL_VERSION,
      clientCapabilities: { auth: { terminal: true } },
      clientInfo: { name: 'test-agent', title: 'Agentctl', version: '1.0.0' },
    });
    expect(res.authMethods).toHaveLength(2);
  });

  it('authenticateConnection sends methodId without meta when params are empty', async () => {
    const mockAuthenticate = vi.fn().mockResolvedValue({});
    const connection = {
      authenticate: mockAuthenticate,
    } as unknown as ClientSideConnection;

    await authenticateConnection(connection, 'google_oauth');

    expect(mockAuthenticate).toHaveBeenCalledWith({
      methodId: 'google_oauth',
    });
  });
});
