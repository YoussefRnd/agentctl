import { z } from 'zod';
import { sessionEventRowSchema } from './session-event.js';

export const sessionEventPageSchema = z.object({
  events: z.array(sessionEventRowSchema),
  nextBeforeId: z.number().int().positive().nullable(),
  nextAfterId: z.number().int().positive().nullable().optional(),
});
export type SessionEventPage = z.infer<typeof sessionEventPageSchema>;

export const sessionEventDetailSchema = z.object({
  event: sessionEventRowSchema,
  revision: z.string().regex(/^[a-f0-9]{64}$/),
});
export type SessionEventDetail = z.infer<typeof sessionEventDetailSchema>;

export const sessionTurnIndexSchema = z.array(
  z.object({
    eventId: z.number().int().positive(),
    prompt: z.string(),
    timestamp: z.iso.datetime(),
    summary: z.string().optional(),
    eventCount: z.number().int().nonnegative().optional(),
    diffStats: z
      .object({
        additions: z.number().nonnegative(),
        deletions: z.number().nonnegative(),
        filesCount: z.number().int().nonnegative(),
      })
      .optional(),
  }),
);
export type SessionTurnAnchor = z.infer<typeof sessionTurnIndexSchema>[number];

export const sessionEventSnapshotSchema = sessionEventPageSchema.extend({
  highWaterId: z.number().int().nonnegative(),
  changeSequence: z.number().int().nonnegative().optional(),
});
export type SessionEventSnapshot = z.infer<typeof sessionEventSnapshotSchema>;
