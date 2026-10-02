import { test, expect } from 'vitest';
import {
  getProviderEnvKeys,
  isProviderEnvKeyOptional,
  providerDiscoverySchema,
} from './session.js';

test('getProviderEnvKeys maps all env vars across multiple methods', () => {
  const provider = {
    id: 'test',
    authMethods: [
      { type: 'env_var', vars: [{ name: 'KEY_ONE' }] },
      { type: 'env_var', vars: [{ name: 'KEY_TWO' }] },
    ],
  };
  expect(getProviderEnvKeys(provider)).toEqual(['KEY_ONE', 'KEY_TWO']);
});

test('isProviderEnvKeyOptional preserves env-var requirement metadata', () => {
  const provider = {
    authMethods: [
      {
        type: 'env_var',
        vars: [
          { name: 'REQUIRED_KEY', optional: false },
          { name: 'OPTIONAL_KEY', optional: true },
        ],
      },
    ],
  };

  expect(isProviderEnvKeyOptional(provider, 'REQUIRED_KEY')).toBe(false);
  expect(isProviderEnvKeyOptional(provider, 'OPTIONAL_KEY')).toBe(true);
  expect(isProviderEnvKeyOptional(provider, 'UNKNOWN_KEY')).toBe(false);
});

test('providerDiscoverySchema preserves an unknown auth state until probing completes', () => {
  const base = {
    id: 'test-id',
    label: 'Test Label',
    enabled: true,
    command: 'test',
    launchArgs: [],
    launchEnv: {},
    customEnv: {},
  };

  expect(providerDiscoverySchema.parse({ ...base, authState: 'unknown' }).authState).toBe(
    'unknown',
  );
  expect(providerDiscoverySchema.parse(base).authState).toBe('unknown');
  expect(providerDiscoverySchema.parse({ ...base, authState: 'needs_auth' }).authState).toBe(
    'required',
  );
});
