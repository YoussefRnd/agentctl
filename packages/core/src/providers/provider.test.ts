import { test, expect } from 'vitest';
import { Provider } from './provider.js';
import type { providers } from '../db/schema.js';

function row(
  overrides: Partial<(typeof providers)['$inferSelect']>,
): (typeof providers)['$inferSelect'] {
  return {
    id: 'claude-acp',
    name: 'Claude',
    installState: 'not_installed',
    authState: 'unknown',
    hidden: false,
    enabled: true,
    command: 'npx',
    launchArgs: '[]',
    launchEnv: '{}',
    customEnv: '{}',
    configOptions: '[]',
    authMethods: '[]',
    version: '1.0.0',
    description: 'desc',
    icon: 'https://example.com/icon.png',
    supportsDynamicModel: false,
    supportsDynamicConfig: false,
    supportsLogout: false,
    nativelyLoadsSkills: false,
    modes: '[]',
    distribution: JSON.stringify({ npx: { package: 'foo', args: [], env: {} } }),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } satisfies (typeof providers)['$inferSelect'];
}

test('Provider.toDiscovery exposes registry distribution', () => {
  const discovery = new Provider(row({})).toDiscovery();
  expect(discovery.agent?.distribution).toEqual({
    npx: { package: 'foo', args: [], env: {} },
  });
});
