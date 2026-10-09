import { z } from 'zod';

export const chatErrorCategorySchema = z.enum([
  'authentication',
  'billing',
  'rate_limit',
  'invalid_request',
  'connection',
  'provider',
  'unknown',
]);
export const chatErrorDeliverySchema = z.enum(['not_sent', 'rejected', 'accepted', 'unknown']);
export const chatErrorActionSchema = z.enum(['retry', 'provider_settings', 'refresh_session']);

/** Public failure data. Raw provider payloads and process diagnostics stay in server logs. */
export const chatErrorSchema = z.object({
  version: z.literal(1),
  id: z.string(),
  category: chatErrorCategorySchema,
  scope: z.enum(['attempt', 'session']),
  stage: z.enum(['prepare', 'dispatch', 'stream']),
  delivery: chatErrorDeliverySchema,
  message: z.string().max(240),
  details: z.string().max(2000).optional(),
  code: z.union([z.number(), z.string().max(100)]).optional(),
  providerId: z.string().optional(),
  attemptId: z.string().optional(),
  eventId: z.number().optional(),
  retryAfterMs: z.number().finite().nonnegative().optional(),
  actions: z.array(chatErrorActionSchema),
});

export type ChatError = z.infer<typeof chatErrorSchema>;
export type ChatErrorCategory = z.infer<typeof chatErrorCategorySchema>;
export type ChatErrorDelivery = z.infer<typeof chatErrorDeliverySchema>;
export type ChatErrorAction = z.infer<typeof chatErrorActionSchema>;
