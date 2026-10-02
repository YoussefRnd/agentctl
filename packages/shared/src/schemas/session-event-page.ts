import { z } from 'zod';
import { sessionEventRowSchema } from './session-event.js';

export const sessionEventPageSchema = z.object({
  events: z.array(sessionEventRowSchema),
  nextBeforeId: z.number().int().positive().nullable(),
});
export type SessionEventPage = z.infer<typeof sessionEventPageSchema>;
