import { describe, expect, it } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { applyStateChange } from './useServerStateSync';
import { mcpKeys, projectKeys, providerKeys, sessionKeys } from '@/shared/lib/queryKeys';

function seed(client: QueryClient, key: readonly unknown[]): void {
  client.setQueryData(key, { loaded: true });
}

describe('applyStateChange', () => {
  it('invalidates only project and session state for a session change', () => {
    const client = new QueryClient();
    seed(client, projectKeys.all);
    seed(client, sessionKeys.detail('session-1'));
    seed(client, providerKeys.all);

    applyStateChange(client, {
      sequence: 1,
      topics: ['projects', 'session'],
      sessionId: 'session-1',
      occurredAt: new Date().toISOString(),
    });

    expect(client.getQueryState(projectKeys.all)?.isInvalidated).toBe(true);
    expect(client.getQueryState(sessionKeys.detail('session-1'))?.isInvalidated).toBe(true);
    expect(client.getQueryState(providerKeys.all)?.isInvalidated).toBe(false);
  });

  it('invalidates workspace, provider, and MCP caches by domain', () => {
    const client = new QueryClient();
    seed(client, sessionKeys.review('session-1'));
    seed(client, sessionKeys.branches('session-1'));
    seed(client, sessionKeys.gitStatus('session-1'));
    seed(client, providerKeys.all);
    seed(client, providerKeys.registry);
    seed(client, mcpKeys.all);
    seed(client, ['mcpTools']);

    applyStateChange(client, {
      sequence: 2,
      topics: ['workspace', 'providers', 'mcp'],
      sessionId: 'session-1',
      occurredAt: new Date().toISOString(),
    });

    for (const key of [
      sessionKeys.review('session-1'),
      sessionKeys.branches('session-1'),
      sessionKeys.gitStatus('session-1'),
      providerKeys.all,
      providerKeys.registry,
      mcpKeys.all,
      ['mcpTools'],
    ]) {
      expect(client.getQueryState(key)?.isInvalidated).toBe(true);
    }
  });
});
