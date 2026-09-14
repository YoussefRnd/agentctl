import Fastify from 'fastify';
import type { ProviderRegistry } from '@agentctl/core/providers';
import type { AgentDiagnosticsSnapshot } from '@agentctl/shared';
import { describe, expect, it, vi } from 'vitest';
import { diagnosticsRoutes } from './diagnostics.js';

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
    await app.register(diagnosticsRoutes, { prefix: '/api' });

    const response = await app.inject({ method: 'GET', url: '/api/diagnostics/transport' });
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['content-disposition']).toContain('attachment');
    expect(response.json()).toMatchObject({ connections: [], events: [{ adapter: 'acp-v1' }] });
    expect(response.body).not.toContain('env');
    expect(response.body).not.toContain('prompt');
    await app.close();
  });
});
