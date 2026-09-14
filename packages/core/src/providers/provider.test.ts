import { test, expect } from 'vitest';
import { Provider } from './provider.js';
import { resolveNpxPackageSpec } from './registry/provider-launcher.js';
import type { providers } from '../db/schema.js';
import { EMPTY_AGENT_FEATURES } from '@agentctl/shared';

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
    capabilitySnapshot: null,
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

test('Provider.toDiscovery exposes a hydrated capability snapshot', () => {
  const verifiedAt = new Date('2026-09-14T12:00:00.000Z');
  const discovery = new Provider(
    row({
      capabilitySnapshot: JSON.stringify({
        features: EMPTY_AGENT_FEATURES,
        source: 'handshake',
        providerVersion: '2.0.0',
        protocolVersion: '1',
        verifiedAt,
      }),
    }),
  ).toDiscovery();

  expect(discovery.snapshot?.verifiedAt).toEqual(verifiedAt);
  expect(discovery.snapshot?.providerVersion).toBe('2.0.0');
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
