import Fastify from 'fastify';
import { initServer } from '@ts-rest/fastify';
import { DEFAULT_FONT_CONFIG, settingsContract } from '@agentctl/shared';
import { expect, test, vi } from 'vitest';
import { createSettingsRouter } from './settings.router.js';

async function settingsApp(initial: Record<string, string> = {}) {
  const app = Fastify();
  const values = { ...initial };
  const publishState = vi.fn();
  app.decorate('providerRegistry', {
    getSettings: () => ({ ...values }),
    updateSetting: (key: string, value: string) => {
      values[key] = value;
    },
  } as never);
  app.decorate('eventBus', { publishState } as never);
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
