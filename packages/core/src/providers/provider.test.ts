import { test, expect } from 'vitest';
import { Provider } from './provider.js';
import { resolveNpxPackageSpec } from './registry/provider-launcher.js';
import type { providers } from '../db/schema.js';

function row(
  overrides: Partial<(typeof providers)['$inferSelect']>,
): (typeof providers)['$inferSelect'] {
  return {
    id: 'claude-acp',
    name: 'Claude',
    installState: 'not_installed',
    installError: null,
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
    features: '{}',
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

test('resolveNpxPackageSpec formats package specifiers correctly without duplication', () => {
  expect(resolveNpxPackageSpec('grok', '0.2.111')).toBe('grok@0.2.111');
  expect(resolveNpxPackageSpec('@xai-official/grok', '0.2.111')).toBe('@xai-official/grok@0.2.111');
  expect(resolveNpxPackageSpec('@xai-official/grok@0.2.111', '0.2.111')).toBe(
    '@xai-official/grok@0.2.111',
  );
  expect(resolveNpxPackageSpec('grok@0.2.111', '0.2.111')).toBe('grok@0.2.111');
  expect(resolveNpxPackageSpec('pkg')).toBe('pkg');
});
