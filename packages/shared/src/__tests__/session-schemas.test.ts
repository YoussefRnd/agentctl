import { test, expect } from 'vitest';
import { getProviderEnvKeys, providerDiscoverySchema } from '../schemas/session.js';

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

test('providerDiscoverySchema parses installState and authState', () => {
  const data = {
    id: 'test-id',
    label: 'Test Label',
    status: 'ready',
    installState: 'installed_local',
    authState: 'authenticated',
    enabled: true,
    command: 'test',
    launchArgs: [],
    launchEnv: {},
    customEnv: {},
    agent: {
      id: 'test-agent',
      name: 'Test Agent',
      version: '1.0.0',
      description: 'a test agent',
      authors: [],
      distribution: {},
    },
  };
  const result = providerDiscoverySchema.safeParse(data);
  expect(result.success).toBe(true);
});
