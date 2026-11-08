import Fastify from 'fastify';
import type { ProviderRegistry } from '@agentctl/core/providers';
import type { AgentDiagnosticsSnapshot } from '@agentctl/shared';
import { describe, expect, it, vi } from 'vite-plus/test';
import tsRestPlugin from '../plugins/ts-rest.js';

describe('transport diagnostics route', () => {
  it('returns a no-store attachment containing only the safe snapshot', async () => {
    const app = Fastify();
    const snapshot: AgentDiagnosticsSnapshot = {
      generatedAt: '2026-09-14T00:00:00.000Z',
      connections: [],
      events: [
        { timestamp: '2026-09-14T00:00:00.000Z', kind: 'adapter_selected', adapter: 'acp-v1' },
      ],
    };
    app.decorate('providerRegistry', {
      getTransportDiagnostics: vi.fn(() => snapshot),
    } as unknown as ProviderRegistry);
    await app.register(tsRestPlugin);

    const response = await app.inject({ method: 'GET', url: '/api/diagnostics/transport' });
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['content-disposition']).toBe(
      'attachment; filename="agentctl-transport-diagnostics.json"',
    );
    expect(response.json()).toEqual(snapshot);
    await app.close();
  });
});
