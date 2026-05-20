import { test, vi, beforeEach } from 'vitest';
import assert from 'node:assert/strict';
import { DriverRegistry } from './acp-driver-registry.js';
import { noopLogger } from '../logger.js';
import type { DbClient } from './acp-session.js';
import type { RegistryAgent } from '@agentctl/shared';

type FetchMock = ReturnType<typeof vi.fn>;

beforeEach(() => {
  global.fetch = vi.fn();
});

test('DriverRegistry sync handles 304 Not Modified', async () => {
  const mockAgents: RegistryAgent[] = [{ 
    id: 'claude-acp', 
    name: 'Claude', 
    version: '1.0.0', 
    description: 'test',
    distribution: { npx: { package: 'p', args: [], env: {} } }, 
    authors: [] 
  }];
  const mockSnapshot = {
    data: JSON.stringify({ agents: mockAgents }),
    etag: 'W/"123"',
    lastModified: 'Wed, 20 May 2026 19:17:08 GMT',
    fetchedAt: new Date(),
  };

  // Mock DB
  const db = {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        orderBy: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([mockSnapshot])
        }),
        where: vi.fn().mockResolvedValue([])
      }),
    }),
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockResolvedValue({})
    }),
  } as unknown as DbClient;

  const fetchMock = global.fetch as unknown as FetchMock;

  // Mock fetch to return 304
  fetchMock.mockResolvedValue({
    status: 304,
    ok: true,
  });

  const registry = new DriverRegistry(db, noopLogger);
  
  // Use a type-safe way to access private method for testing
  interface RegistryInternal {
    fetchRegistryWithCache(): Promise<{ agents: RegistryAgent[]; source: 'remote' | 'cache' }>;
  }
  const registryInternal = registry as unknown as RegistryInternal;
  await registryInternal.fetchRegistryWithCache();

  const lastCall = fetchMock.mock.calls[0];
  const options = lastCall[1] as RequestInit;
  const headers = options.headers as Record<string, string>;
  assert.equal(headers['If-None-Match'], 'W/"123"');
});

test('DriverRegistry sync falls back to cache on fetch error', async () => {
  const mockAgents: RegistryAgent[] = [{ 
    id: 'claude-acp', 
    name: 'Claude', 
    version: '1.0.0', 
    description: 'test',
    distribution: { npx: { package: 'p', args: [], env: {} } }, 
    authors: [] 
  }];
  const mockSnapshot = {
    data: JSON.stringify({ agents: mockAgents }),
    fetchedAt: new Date(),
  };

  const db = {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        orderBy: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([mockSnapshot])
        })
      }),
    }),
  } as unknown as DbClient;

  const fetchMock = global.fetch as unknown as FetchMock;
  fetchMock.mockRejectedValue(new Error('Network error'));

  const registry = new DriverRegistry(db, noopLogger);
  
  interface RegistryInternal {
    fetchRegistryWithCache(): Promise<{ agents: RegistryAgent[]; source: 'remote' | 'cache' }>;
  }
  const registryInternal = registry as unknown as RegistryInternal;
  const result = await registryInternal.fetchRegistryWithCache();

  assert.equal(result.agents.length, 1);
  assert.equal(result.source, 'cache');
});
