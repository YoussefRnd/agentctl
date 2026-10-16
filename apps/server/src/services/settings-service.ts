import { readGitTextGenerationSetting, validateGitTextGenerationSetting } from '@agentctl/core/git';
import type { ProviderRegistry } from '@agentctl/core/providers';
import { DEFAULT_FONT_CONFIG, settingsContract, type FontConfig } from '@agentctl/shared';
import type { z } from 'zod';
import type { EventBus } from '../utils/event-bus.js';
import { AppError } from '../errors/app-error.js';

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

export class SettingsService {
  constructor(
    private readonly providers: ProviderRegistry,
    private readonly events: Pick<EventBus, 'publishState'>,
  ) {}
  async read() {
    const raw = this.providers.getSettings();
    return {
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
    };
  }
  async patch(body: z.infer<typeof settingsContract.patchSettings.body>) {
    if (body.gitTextGeneration) {
      try {
        validateGitTextGenerationSetting(this.providers, body.gitTextGeneration);
      } catch (error) {
        throw new AppError(error instanceof Error ? error.message : String(error), 400);
      }
    }
    if (body.gitTextGeneration !== undefined) {
      this.providers.updateSetting('gitTextGeneration', JSON.stringify(body.gitTextGeneration));
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
      if (body[key] !== undefined) this.providers.updateSetting(key, String(body[key] ?? ''));
    }
    if (body.fontConfig !== undefined) {
      const prev = readFontConfig(this.providers.getSettings().fontConfig);
      const merged: FontConfig = {
        ui: body.fontConfig.ui ? { ...prev.ui, ...body.fontConfig.ui } : prev.ui,
        code: body.fontConfig.code ? { ...prev.code, ...body.fontConfig.code } : prev.code,
      };
      this.providers.updateSetting('fontConfig', JSON.stringify(merged));
    }
    this.events.publishState({ topics: ['settings'] });
    return this.read();
  }
}
