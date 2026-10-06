import { expect, test } from 'vitest';
import { buildBaseSessionParams } from './session-params.js';
import { parseAcpCapabilities } from '../transport/capabilities-cache.js';

test('rejects relative session paths before sending them to the provider', () => {
  expect(() => buildBaseSessionParams({ cwd: 'relative' })).toThrow('must be absolute');
  expect(() =>
    buildBaseSessionParams({
      cwd: '/tmp',
      supportsAdditionalDirectories: true,
      additionalDirectories: ['relative'],
    }),
  ).toThrow('must be absolute');
});

test('v1 passes only negotiated MCP transports and retains baseline stdio support', () => {
  const mcpServers = [
    { name: 'stdio', command: 'unused', args: [], env: [] },
    { type: 'http' as const, name: 'http', url: 'https://example.com/mcp', headers: [] },
    { type: 'sse' as const, name: 'sse', url: 'https://example.com/sse', headers: [] },
  ];
  const capabilities = parseAcpCapabilities({ mcpCapabilities: { http: true } });
  expect(buildBaseSessionParams({ cwd: '/tmp', mcpServers, ...capabilities }).mcpServers).toEqual(
    mcpServers.slice(0, 2),
  );
  expect(buildBaseSessionParams({ cwd: '/tmp', mcpServers }).mcpServers).toEqual([mcpServers[0]]);
});
