import type { FastifyPluginCallbackZod } from '@fastify/type-provider-zod';
import type { ZodTypeProvider } from '@fastify/type-provider-zod';
import { z } from 'zod';

const patchSettingsSchema = z.object({
  onboardingCompleted: z.boolean().optional(),
  onboardingVersion: z.union([z.string(), z.number()]).optional(),
  setupStep: z.string().nullable().optional(),
  defaultProviderId: z.string().nullable().optional(),
});

function normalizeNullableSetting(value: string | undefined): string | null {
  return value ?? null;
}

function toSettingsResponse(settings: {
  onboardingCompleted?: string;
  onboardingVersion?: string;
  setupStep?: string;
  defaultProviderId?: string;
}) {
  return {
    onboardingCompleted: settings.onboardingCompleted === 'true',
    onboardingVersion: settings.onboardingVersion ?? '1.0.0',
    setupStep: normalizeNullableSetting(settings.setupStep),
    defaultProviderId: normalizeNullableSetting(settings.defaultProviderId),
  };
}

export const settingsRoutes: FastifyPluginCallbackZod = (fastify, _opts, done) => {
  fastify.withTypeProvider<ZodTypeProvider>().get('/settings', async () => {
    const raw = await fastify.providerRegistry.getSettings();
    return toSettingsResponse(raw);
  });

  fastify.withTypeProvider<ZodTypeProvider>().patch(
    '/settings',
    {
      schema: {
        body: patchSettingsSchema,
      },
    },
    async (request) => {
      const body = request.body;
      if (body.onboardingCompleted !== undefined) {
        await fastify.providerRegistry.updateSetting(
          'onboardingCompleted',
          String(body.onboardingCompleted),
        );
      }
      if (body.onboardingVersion !== undefined) {
        await fastify.providerRegistry.updateSetting(
          'onboardingVersion',
          String(body.onboardingVersion),
        );
      }
      if (body.setupStep !== undefined) {
        await fastify.providerRegistry.updateSetting('setupStep', body.setupStep ?? '');
      }
      if (body.defaultProviderId !== undefined) {
        await fastify.providerRegistry.updateSetting(
          'defaultProviderId',
          body.defaultProviderId ?? '',
        );
      }
      const raw = await fastify.providerRegistry.getSettings();
      return toSettingsResponse(raw);
    },
  );

  done();
};
