import { beforeEach, expect, it } from 'vitest';
import { createDatabase, providers } from '../db/index.js';
import { ProviderRegistry } from '../providers/provider-registry.js';
import {
  resolveGitTextGenerationSelection,
  validateGitTextGenerationSetting,
} from './text-generation-settings.js';
let registry: ProviderRegistry;
const session = { selectedProvider: 'session', selectedModel: 'session-model' };
beforeEach(() => {
  const db = createDatabase(':memory:');
  for (const id of ['session', 'writer', 'writer-profile'])
    db.insert(providers)
      .values({
        id,
        name: id,
        command: id,
        registryAgentId: id === 'writer-profile' ? 'writer' : null,
        installState: 'system_available',
        authState: 'not_required',
        connectionState: 'ready',
        enabled: true,
        defaultModel: id === 'writer-profile' ? 'profile-model' : 'writer-default',
        configOptions: JSON.stringify([
          {
            id: 'llm',
            name: 'Model',
            category: 'model',
            currentValue: 'fast',
            options: [{ value: 'fast', name: 'Fast' }],
          },
        ]),
        customModels: JSON.stringify([{ id: 'custom', name: 'My custom model' }]),
      })
      .run();
  registry = new ProviderRegistry(db);
});
it('defaults to the session and clearing the override restores it', () => {
  expect(resolveGitTextGenerationSelection(registry, session)).toMatchObject({
    provider: { id: 'session' },
    modelId: 'session-model',
  });
  registry.updateSetting(
    'gitTextGeneration',
    JSON.stringify({ providerId: 'writer', modelId: 'fast' }),
  );
  expect(registry.getSettings().gitTextGeneration).toContain('writer');
  expect(resolveGitTextGenerationSelection(registry, session)).toMatchObject({
    provider: { id: 'writer' },
    modelId: 'fast',
  });
  registry.updateSetting('gitTextGeneration', 'null');
  expect(resolveGitTextGenerationSelection(registry, session)).toMatchObject({
    provider: { id: 'session' },
    modelId: 'session-model',
  });
});
it('keeps profile-specific defaults and custom models separate from the chat provider', () => {
  registry.updateSetting(
    'gitTextGeneration',
    JSON.stringify({ providerId: 'writer-profile', modelId: null }),
  );
  expect(resolveGitTextGenerationSelection(registry, session)).toMatchObject({
    provider: { id: 'writer-profile' },
    modelId: 'profile-model',
  });
  registry.updateSetting(
    'gitTextGeneration',
    JSON.stringify({ providerId: 'writer-profile', modelId: 'custom' }),
  );
  expect(resolveGitTextGenerationSelection(registry, session).modelId).toBe('custom');
  expect(session).toEqual({ selectedProvider: 'session', selectedModel: 'session-model' });
});
it.each(['deleted', 'disabled', 'uninstalled', 'hidden'])(
  'refuses a %s provider without falling back',
  (state) => {
    const provider = registry.getProvider('writer')!;
    const blocked = new Proxy(provider, {
      get(target, key) {
        if (key === 'isInstalled' && state === 'uninstalled') return false;
        if (key === 'toDiscovery')
          return () => ({
            ...target.toDiscovery(),
            enabled: state !== 'disabled',
            hidden: state === 'hidden',
          });
        return Reflect.get(target, key);
      },
    });
    const original = registry.getProvider.bind(registry);
    registry.getProvider = (id) =>
      id === 'writer' ? (state === 'deleted' ? undefined : blocked) : original(id);
    registry.updateSetting(
      'gitTextGeneration',
      JSON.stringify({ providerId: 'writer', modelId: null }),
    );
    expect(() => resolveGitTextGenerationSelection(registry, session)).toThrow('unavailable');
  },
);
it('rejects a model from another provider and malformed stored settings', () => {
  expect(() =>
    validateGitTextGenerationSetting(registry, { providerId: 'writer', modelId: 'session-model' }),
  ).toThrow('model is no longer available');
  registry.updateSetting('gitTextGeneration', '{broken');
  expect(() => resolveGitTextGenerationSelection(registry, session)).toThrow(
    'settings are invalid',
  );
});
it('allows saving an installed provider before login, but generation requires it to be ready', () => {
  const provider = registry.getProvider('writer')!;
  const unavailable = new Proxy(provider, {
    get(target, key) {
      return key === 'isReady' ? false : Reflect.get(target, key);
    },
  });
  const original = registry.getProvider.bind(registry);
  registry.getProvider = (id) => (id === 'writer' ? unavailable : original(id));
  expect(
    validateGitTextGenerationSetting(registry, { providerId: 'writer', modelId: 'fast' }),
  ).toBe(unavailable);
  registry.updateSetting(
    'gitTextGeneration',
    JSON.stringify({ providerId: 'writer', modelId: 'fast' }),
  );
  expect(() => resolveGitTextGenerationSelection(registry, session)).toThrow(
    'Connect the selected Git generation provider',
  );
});
