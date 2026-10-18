import { expect, test, vi } from 'vite-plus/test';
import {
  AgentSideConnection,
  ClientSideConnection,
  ndJsonStream,
  type Agent,
} from '@agentclientprotocol/sdk';
import { forkProviderSession } from './session-fork.js';
import { parseAcpCapabilities } from '../v1/capabilities.js';

test('the installed SDK dispatches a fork request with the destination workspace and returns its independent session id', async () => {
  const outgoing = new TransformStream<Uint8Array>();
  const incoming = new TransformStream<Uint8Array>();
  const fork = vi.fn().mockResolvedValue({ sessionId: 'independent-session' });
  new AgentSideConnection(
    () => ({ unstable_forkSession: fork }) as unknown as Agent,
    ndJsonStream(incoming.writable, outgoing.readable),
  );
  const connection = new ClientSideConnection(
    () => ({
      sessionUpdate: async () => {},
      requestPermission: async () => ({ outcome: { outcome: 'cancelled' } }),
    }),
    ndJsonStream(outgoing.writable, incoming.readable),
  );
  const request = { sessionId: 'original', cwd: '/tmp/fork', mcpServers: [] };
  expect(
    await forkProviderSession(
      connection,
      parseAcpCapabilities({ sessionCapabilities: { fork: {} } }),
      request,
      1000,
    ),
  ).toEqual({ sessionId: 'independent-session' });
  expect(fork).toHaveBeenCalledWith(request);
});
