import { test, expect } from 'vite-plus/test';
import {
  getProviderEnvKeys,
  isProviderEnvKeyOptional,
  providerDiscoverySchema,
  sessionRowSchema,
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

test('session rows decode older JSON fields and recover missing or malformed fields', () => {
  const row = {
    id: 'd00b384e-1d0a-4d10-aee5-39c582f22361',
    projectId: '0dd9f402-6408-40db-a266-99fe0d4e8370',
    branch: 'main',
    taskSlug: 'test',
    title: 'Test',
    baseCommit: 'none',
    worktreePath: '/workspace',
    agentSessionId: null,
    status: 'idle',
    totalTokens: 0,
    contextLimit: 100,
    estimatedCost: 0,
    lastHeartbeat: null,
    closedAt: null,
    lastActivityAt: '2026-01-01',
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
    selectedProvider: 'provider',
    selectedModel: 'model',
    selectedThinkingEffort: null,
    approvalMode: 'review',
    availableAgentPersonas: '["architect"]',
    availableCommands: null,
    planArtifacts: '{',
    sessionMetrics: '{"totalTokens":42}',
  };
  expect(sessionRowSchema.parse(row)).toMatchObject({
    availableAgentPersonas: ['architect'],
    availableCommands: [],
    planArtifacts: [],
    plan: [],
    sessionConfigOptions: [],
    sessionMetrics: { totalTokens: 42 },
  });
  expect(sessionRowSchema.safeParse({ ...row, availableAgentPersonas: '{}' }).success).toBe(false);
});
