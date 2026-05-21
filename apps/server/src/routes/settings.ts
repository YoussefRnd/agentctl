import type { FastifyPluginCallbackZod } from '@fastify/type-provider-zod';
import type { ZodTypeProvider } from '@fastify/type-provider-zod';
import { z } from 'zod';

const patchSettingsSchema = z.object({
	onboardingCompleted: z.boolean().optional(),
	onboardingVersion: z.union([z.string(), z.number()]).optional(),
	setupStep: z.string().nullable().optional(),
	defaultDriverId: z.string().nullable().optional(),
});

function normalizeNullableSetting(value: string | undefined): string | null {
	return value ?? null;
}

function toSettingsResponse(settings: {
	onboardingCompleted?: string;
	onboardingVersion?: string;
	setupStep?: string;
	defaultDriverId?: string;
}) {
	return {
		onboardingCompleted: settings.onboardingCompleted === 'true',
		onboardingVersion: settings.onboardingVersion ?? '1.0.0',
		setupStep: normalizeNullableSetting(settings.setupStep),
		defaultDriverId: normalizeNullableSetting(settings.defaultDriverId),
	};
}

export const settingsRoutes: FastifyPluginCallbackZod = (fastify, _opts, done) => {
	fastify.withTypeProvider<ZodTypeProvider>().get('/settings', async () => {
		const raw = await fastify.driverRegistry.getSettings();
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
				await fastify.driverRegistry.updateSetting('onboardingCompleted', String(body.onboardingCompleted));
			}
			if (body.onboardingVersion !== undefined) {
				await fastify.driverRegistry.updateSetting('onboardingVersion', String(body.onboardingVersion));
			}
			if (body.setupStep !== undefined) {
				await fastify.driverRegistry.updateSetting('setupStep', body.setupStep ?? '');
			}
			if (body.defaultDriverId !== undefined) {
				await fastify.driverRegistry.updateSetting('defaultDriverId', body.defaultDriverId ?? '');
			}
			const raw = await fastify.driverRegistry.getSettings();
			return toSettingsResponse(raw);
		},
	);

	done();
};
