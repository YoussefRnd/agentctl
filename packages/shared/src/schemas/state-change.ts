import { z } from 'zod';

export const stateChangeTopicSchema = z.enum([
  'projects',
  'providers',
  'session',
  'workspace',
  'mcp',
  'settings',
]);

export const stateChangeEventSchema = z.object({
  sequence: z.number().int().nonnegative(),
  topics: z.array(stateChangeTopicSchema).min(1),
  sessionId: z.string().optional(),
  occurredAt: z.string(),
});

export type StateChangeTopic = z.infer<typeof stateChangeTopicSchema>;
export type StateChangeEvent = z.infer<typeof stateChangeEventSchema>;
