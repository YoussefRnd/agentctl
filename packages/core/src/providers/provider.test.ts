import { test, expect } from 'vitest';
import { Provider } from './provider.js';
import { resolveNpxPackageSpec } from './registry/provider-launcher.js';
import type { providers } from '../db/schema.js';
import { EMPTY_AGENT_FEATURES } from '@agentctl/shared';
import { defaultCredentialVault } from '../security/credential-vault.js';
import { negotiateCapabilities } from './capabilities-negotiator.js';

test('negotiates and defaults categorized model and reasoning options with opaque IDs', () => {
  const provider = new Provider(
    row({
      configOptions: JSON.stringify([
        {
          id: 'preferred_llm',
          category: 'model',
          name: 'Model',
          type: 'select',
          currentValue: 'second',
          options: [
            { value: 'first', name: 'First' },
            { value: 'second', name: 'Second' },
          ],
        },
        {
          id: 'reasoning_budget',
          category: 'thought_level',
          name: 'Reasoning',
          type: 'select',
          currentValue: 'high',
          options: [
            { value: 'low', name: 'Low' },
            { value: 'high', name: 'High' },
          ],
        },
      ]),
    }),
  );
  expect(provider.resolveDefaultSelection()).toEqual({
    selectedModel: 'second',
    selectedThinkingEffort: 'high',
  });
  expect(negotiateCapabilities(provider, 'first', 'low')).toMatchObject({
    selectedModel: 'first',
    selectedThinkingEffort: 'low',
    resolvedModelConfigId: 'preferred_llm',
    resolvedThinkingConfigId: 'reasoning_budget',
  });
});

test('preserves provider-specific effort IDs and prefers advertised defaults over the first option', () => {
  const data = row({
    configOptions: JSON.stringify([
      {
        id: 'effort',
        category: 'thought_level',
        name: 'Reasoning',
        type: 'select',
        currentValue: 'default',
        options: ['none', 'thinking', 'default'].map((value) => ({ value, name: value })),
      },
    ]),
  });
  const provider = new Provider(data);
  expect(provider.resolveDefaultSelection().selectedThinkingEffort).toBe('default');
  for (const effort of ['none', 'thinking', 'default']) {
    expect(negotiateCapabilities(provider, undefined, effort).selectedThinkingEffort).toBe(effort);
  }
  expect(negotiateCapabilities(provider, undefined, 'medium').selectedThinkingEffort).toBe(
    'default',
  );
  expect(
    new Provider({ ...data, defaultThinkingEffort: 'thinking' }).resolveDefaultSelection()
      .selectedThinkingEffort,
  ).toBe('thinking');
  expect(
    new Provider({ ...data, defaultThinkingEffort: 'stale-value' }).resolveDefaultSelection()
      .selectedThinkingEffort,
  ).toBe('default');
});

function row(
  overrides: Partial<(typeof providers)['$inferSelect']>,
): (typeof providers)['$inferSelect'] {
  return {
    customModels: '[]',
    registryAgentId: null,
    protocol: 'auto',
    defaultModel: null,
    defaultThinkingEffort: null,
    id: 'claude-acp',
    name: 'Claude',
    installState: 'not_installed',
    installError: null,
    installStage: null,
    installSource: null,
    installedVersion: null,
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
    connectionState: 'unknown',
    authError: null,
    lastVerifiedAt: null,
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

test('does not invent a reasoning override when no effort option is advertised', () => {
  const provider = new Provider(row({ defaultThinkingEffort: 'ultra' }));
  expect(provider.resolveDefaultSelection().selectedThinkingEffort).toBeNull();
  expect(negotiateCapabilities(provider, undefined, 'high').selectedThinkingEffort).toBeNull();
  expect(provider.getLaunchConfig('default', null).args).not.toContain('--thinking-effort');
});

test('Provider only reports ready after auth status is known', () => {
  expect(new Provider(row({ installState: 'system_available', authState: 'unknown' })).status).toBe(
    'inactive',
  );
  expect(
    new Provider(row({ installState: 'system_available', authState: 'not_required' })).status,
  ).toBe('ready');
  expect(
    new Provider(row({ installState: 'system_available', authState: 'authenticated' })).status,
  ).toBe('ready');
});

test('Provider ignores malformed persisted auth errors', () => {
  expect(new Provider(row({ authError: '{bad json' })).toDiscovery().authError).toBeNull();
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

test('Provider resolves vaulted environment values before launching a session', async () => {
  const providerId = `vault-launch-${process.pid.toString()}`;
  const ref = await defaultCredentialVault.setSecret(providerId, 'API_KEY', 'secret-value');
  try {
    const launch = new Provider(
      row({
        id: providerId,
        customEnv: JSON.stringify({ API_KEY: ref }),
        launchEnv: JSON.stringify({ PUBLIC_VALUE: 'visible' }),
      }),
    ).getLaunchConfig('default', 'medium');

    expect(launch.env).toEqual({ PUBLIC_VALUE: 'visible', API_KEY: 'secret-value' });
  } finally {
    await defaultCredentialVault.deleteProviderSecrets(providerId);
  }
});
