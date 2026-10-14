import { readGitTextGenerationSetting, validateGitTextGenerationSetting } from '@agentctl/core/git';
import type { FastifyInstance } from 'fastify';
import type { RouterImplementation } from '@ts-rest/fastify';
import { DEFAULT_FONT_CONFIG, settingsContract, type FontConfig } from '@agentctl/shared';

function readFontConfig(value?: string): FontConfig {
  if (!value) return DEFAULT_FONT_CONFIG;
  try {
    const parsed = JSON.parse(value) as Record<
      string,
      { family: string; size: number } | undefined
    >;
    return {
      ui: parsed.ui ?? parsed.chat ?? DEFAULT_FONT_CONFIG.ui,
      code: parsed.code ?? parsed.buffer ?? parsed.terminal ?? DEFAULT_FONT_CONFIG.code,
    };
  } catch {
    return DEFAULT_FONT_CONFIG;
  }
}

export function createSettingsRouter(
  fastify: FastifyInstance,
): RouterImplementation<typeof settingsContract> {
  const readSettings = async () => {
    const raw = fastify.providerRegistry.getSettings();
    return {
      status: 200 as const,
      body: {
        onboardingCompleted: raw.onboardingCompleted === 'true',
        onboardingVersion: raw.onboardingVersion ?? '1.0.0',
        setupStep: raw.setupStep ?? null,
        defaultProviderId: raw.defaultProviderId ?? null,
        gitTextGeneration: (() => {
          try {
            return readGitTextGenerationSetting(raw.gitTextGeneration);
          } catch {
            return null;
          }
        })(),
        showThinking: raw.showThinking === 'true',
        defaultToWorktree:
          raw.defaultToWorktree !== undefined ? raw.defaultToWorktree === 'true' : true,
        registrySyncError: raw.registrySyncError ?? null,
        fontConfig: readFontConfig(raw.fontConfig),
      },
    };
  };
  return {
    getSettings: readSettings,
    patchSettings: async ({ body }) => {
      if (body.gitTextGeneration) {
        try {
          validateGitTextGenerationSetting(fastify.providerRegistry, body.gitTextGeneration);
        } catch (error) {
          return {
            status: 400 as const,
            body: { message: error instanceof Error ? error.message : String(error) },
          };
        }
      }
      if (body.gitTextGeneration !== undefined) {
        fastify.providerRegistry.updateSetting(
          'gitTextGeneration',
          JSON.stringify(body.gitTextGeneration),
        );
      }
      for (const key of [
        'onboardingCompleted',
        'onboardingVersion',
        'setupStep',
        'defaultProviderId',
        'showThinking',
        'defaultToWorktree',
        'registrySyncError',
      ] as const) {
        if (body[key] !== undefined)
          fastify.providerRegistry.updateSetting(key, String(body[key] ?? ''));
      }
      if (body.fontConfig !== undefined) {
        const prev = readFontConfig(fastify.providerRegistry.getSettings().fontConfig);
        const merged: FontConfig = {
          ui: body.fontConfig.ui ? { ...prev.ui, ...body.fontConfig.ui } : prev.ui,
          code: body.fontConfig.code ? { ...prev.code, ...body.fontConfig.code } : prev.code,
        };
        fastify.providerRegistry.updateSetting('fontConfig', JSON.stringify(merged));
      }
      fastify.eventBus.publishState({ topics: ['settings'] });
      return readSettings();
    },
  };
}
