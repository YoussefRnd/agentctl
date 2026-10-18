import { createServerServices } from '../../composition/server-services.js';
import Fastify from 'fastify';
import { initServer } from '@ts-rest/fastify';
import { DEFAULT_FONT_CONFIG, settingsContract } from '@agentctl/shared';
import { expect, test, vi } from 'vite-plus/test';
import { createSettingsRouter } from './settings.router.js';

async function settingsApp(initial: Record<string, string> = {}) {
  const app = Fastify();
  const values = { ...initial };
  const publishState = vi.fn();
  app.decorate('providerRegistry', {
    getSettings: () => ({ ...values }),
    getProvider: (id: string) =>
      id === 'writer'
        ? {
            isInstalled: true,
            toDiscovery: () => ({
              enabled: true,
              hidden: false,
              customModels: [{ id: 'custom', name: 'Custom' }],
              configOptions: [
                { id: 'llm', category: 'model', options: [{ value: 'fast', name: 'Fast' }] },
              ],
            }),
          }
        : undefined,
    updateSetting: (key: string, value: string) => {
      values[key] = value;
    },
  } as never);
  app.decorate('eventBus', { publishState } as never);
  app.decorate('services', createServerServices(app));
  const server = initServer();
  await app.register(server.plugin(server.router(settingsContract, createSettingsRouter(app))));
  return { app, values, publishState };
}

test('settings PATCH preserves omitted values and round-trips false and cleared fields', async () => {
  const { app, values, publishState } = await settingsApp({
    onboardingCompleted: 'true',
    showThinking: 'true',
    setupStep: 'agents',
    registrySyncError: 'offline',
  });
  try {
    const response = await app.inject({
      method: 'PATCH',
      url: '/api/settings',
      payload: {
        showThinking: false,
        defaultToWorktree: false,
        setupStep: null,
        registrySyncError: null,
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      onboardingCompleted: true,
      showThinking: false,
      defaultToWorktree: false,
      setupStep: '',
      registrySyncError: '',
    });
    expect(values.showThinking).toBe('false');
    expect(values.setupStep).toBe('');
    expect((await app.inject('/api/settings')).json()).toEqual(response.json());
    expect(publishState).toHaveBeenCalledOnce();
  } finally {
    await app.close();
  }
});

test('font updates retain legacy chat and terminal settings when only one context changes', async () => {
  const legacy = { chat: { family: 'Inter', size: 14 }, terminal: { family: 'Mono', size: 16 } };
  const { app } = await settingsApp({ fontConfig: JSON.stringify(legacy) });
  try {
    expect((await app.inject('/api/settings')).json().fontConfig).toEqual({
      ui: legacy.chat,
      code: legacy.terminal,
    });
    const response = await app.inject({
      method: 'PATCH',
      url: '/api/settings',
      payload: {
        fontConfig: { ui: { family: 'Geist', size: 18 } },
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().fontConfig).toEqual({
      ui: { family: 'Geist', size: 18 },
      code: legacy.terminal,
    });
    expect((await app.inject('/api/settings')).json()).toEqual(response.json());
  } finally {
    await app.close();
  }
});

test('malformed saved fonts use defaults and invalid patches publish no change', async () => {
  const { app, publishState } = await settingsApp({ fontConfig: '{broken' });
  try {
    expect((await app.inject('/api/settings')).json().fontConfig).toEqual(DEFAULT_FONT_CONFIG);
    const response = await app.inject({
      method: 'PATCH',
      url: '/api/settings',
      payload: {
        fontConfig: { ui: { family: 'Geist', size: 1 } },
      },
    });
    expect(response.statusCode).toBe(400);
    expect(publishState).not.toHaveBeenCalled();
  } finally {
    await app.close();
  }
});

test('generation settings round-trip a dedicated provider/model and reset to session defaults', async () => {
  const { app, values } = await settingsApp();
  try {
    expect((await app.inject('/api/settings')).json().gitTextGeneration).toBeNull();
    const selection = { providerId: 'writer', modelId: 'fast' };
    const response = await app.inject({
      method: 'PATCH',
      url: '/api/settings',
      payload: { gitTextGeneration: selection },
    });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json().gitTextGeneration).toEqual(selection);
    expect(JSON.parse(values.gitTextGeneration!)).toEqual(selection);
    expect(
      (
        await app.inject({ method: 'PATCH', url: '/api/settings', payload: { showThinking: true } })
      ).json().gitTextGeneration,
    ).toEqual(selection);
    expect((await app.inject('/api/settings')).json().gitTextGeneration).toEqual(selection);
    expect(
      (
        await app.inject({
          method: 'PATCH',
          url: '/api/settings',
          payload: { gitTextGeneration: null },
        })
      ).json().gitTextGeneration,
    ).toBeNull();
  } finally {
    await app.close();
  }
});
test.each([
  { providerId: 'missing', modelId: null },
  { providerId: 'writer', modelId: 'wrong-provider-model' },
  { providerId: '', modelId: 'fast' },
  { providerId: 'writer' },
])('invalid generation selections cannot partially save other settings: %j', async (selection) => {
  const { app, values, publishState } = await settingsApp({
    showThinking: 'true',
    gitTextGeneration: JSON.stringify({ providerId: 'writer', modelId: null }),
  });
  try {
    const before = { ...values };
    const response = await app.inject({
      method: 'PATCH',
      url: '/api/settings',
      payload: { gitTextGeneration: selection, showThinking: false },
    });
    expect(response.statusCode).toBe(400);
    expect(values).toEqual(before);
    expect(publishState).not.toHaveBeenCalled();
  } finally {
    await app.close();
  }
});
test('custom models and provider defaults can be saved, and malformed saved settings can be repaired', async () => {
  const { app } = await settingsApp({ gitTextGeneration: '{broken' });
  try {
    expect((await app.inject('/api/settings')).json().gitTextGeneration).toBeNull();
    for (const modelId of ['custom', null]) {
      const response = await app.inject({
        method: 'PATCH',
        url: '/api/settings',
        payload: { gitTextGeneration: { providerId: 'writer', modelId } },
      });
      expect(response.statusCode, response.body).toBe(200);
      expect(response.json().gitTextGeneration).toEqual({ providerId: 'writer', modelId });
    }
  } finally {
    await app.close();
  }
});
