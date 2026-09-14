import type { FastifyInstance } from 'fastify';
import type { RouterImplementation } from '@ts-rest/fastify';
import { DEFAULT_FONT_CONFIG, settingsContract, type FontConfig } from '@agentctl/shared';

export function createSettingsRouter(
  fastify: FastifyInstance,
): RouterImplementation<typeof settingsContract> {
  return {
    getSettings: () => {
      const raw = fastify.providerRegistry.getSettings();
      let fontConfig: FontConfig = DEFAULT_FONT_CONFIG;
      if (raw.fontConfig) {
        try {
          const parsed = JSON.parse(raw.fontConfig) as Record<
            string,
            { family: string; size: number } | undefined
          >;
          fontConfig = {
            ui: parsed.ui ?? parsed.chat ?? DEFAULT_FONT_CONFIG.ui,
            code: parsed.code ?? parsed.buffer ?? parsed.terminal ?? DEFAULT_FONT_CONFIG.code,
          };
        } catch {
          /* use default */
        }
      }
      return Promise.resolve({
        status: 200 as const,
        body: {
          onboardingCompleted: raw.onboardingCompleted === 'true',
          onboardingVersion: raw.onboardingVersion ?? '1.0.0',
          setupStep: raw.setupStep ?? null,
          defaultProviderId: raw.defaultProviderId ?? null,
          showThinking: raw.showThinking === 'true',
          registrySyncError: raw.registrySyncError ?? null,
          fontConfig,
        },
      });
    },
    patchSettings: ({
      body,
    }: {
      body: {
        onboardingCompleted?: boolean;
        onboardingVersion?: string | number;
        setupStep?: string | null;
        defaultProviderId?: string | null;
        showThinking?: boolean;
        registrySyncError?: string | null;
        fontConfig?: {
          ui?: { family: string; size: number };
          code?: { family: string; size: number };
        };
      };
    }) => {
      if (body.onboardingCompleted !== undefined) {
        fastify.providerRegistry.updateSetting(
          'onboardingCompleted',
          String(body.onboardingCompleted),
        );
      }
      if (body.onboardingVersion !== undefined) {
        fastify.providerRegistry.updateSetting('onboardingVersion', String(body.onboardingVersion));
      }
      if (body.setupStep !== undefined) {
        fastify.providerRegistry.updateSetting('setupStep', body.setupStep ?? '');
      }
      if (body.defaultProviderId !== undefined) {
        fastify.providerRegistry.updateSetting('defaultProviderId', body.defaultProviderId ?? '');
      }
      if (body.showThinking !== undefined) {
        fastify.providerRegistry.updateSetting('showThinking', String(body.showThinking));
      }
      if (body.registrySyncError !== undefined) {
        fastify.providerRegistry.updateSetting('registrySyncError', body.registrySyncError ?? '');
      }
      if (body.fontConfig !== undefined) {
        const existing = fastify.providerRegistry.getSettings();
        let prev = DEFAULT_FONT_CONFIG;
        if (existing.fontConfig) {
          try {
            const parsed = JSON.parse(existing.fontConfig) as Record<
              string,
              { family: string; size: number } | undefined
            >;
            prev = {
              ui: parsed.ui ?? parsed.chat ?? DEFAULT_FONT_CONFIG.ui,
              code: parsed.code ?? parsed.buffer ?? parsed.terminal ?? DEFAULT_FONT_CONFIG.code,
            };
          } catch {
            /* use default */
          }
        }
        const merged: FontConfig = {
          ui: body.fontConfig.ui ? { ...prev.ui, ...body.fontConfig.ui } : prev.ui,
          code: body.fontConfig.code ? { ...prev.code, ...body.fontConfig.code } : prev.code,
        };
        fastify.providerRegistry.updateSetting('fontConfig', JSON.stringify(merged));
      }
      const raw = fastify.providerRegistry.getSettings();
      let fontConfig: FontConfig = DEFAULT_FONT_CONFIG;
      if (raw.fontConfig) {
        try {
          const parsed = JSON.parse(raw.fontConfig) as Record<
            string,
            { family: string; size: number } | undefined
          >;
          fontConfig = {
            ui: parsed.ui ?? parsed.chat ?? DEFAULT_FONT_CONFIG.ui,
            code: parsed.code ?? parsed.buffer ?? parsed.terminal ?? DEFAULT_FONT_CONFIG.code,
          };
        } catch {
          /* use default */
        }
      }
      return Promise.resolve({
        status: 200 as const,
        body: {
          onboardingCompleted: raw.onboardingCompleted === 'true',
          onboardingVersion: raw.onboardingVersion ?? '1.0.0',
          setupStep: raw.setupStep ?? null,
          defaultProviderId: raw.defaultProviderId ?? null,
          showThinking: raw.showThinking === 'true',
          registrySyncError: raw.registrySyncError ?? null,
          fontConfig,
        },
      });
    },
  };
}
