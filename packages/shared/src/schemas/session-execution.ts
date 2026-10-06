import { z } from 'zod';

export const turnTimingsSchema = z.object({
  preparationMs: z.number().nonnegative().optional(),
  acceptanceMs: z.number().nonnegative().optional(),
  firstOutputMs: z.number().nonnegative().optional(),
  completionMs: z.number().nonnegative().optional(),
});
export type TurnTimings = z.infer<typeof turnTimingsSchema>;
export const sessionExecutionErrorSchema = z.object({
  message: z.string(),
  code: z.number().optional(),
  data: z.unknown().optional(),
});

export const sessionExecutionSchema = z.object({
  connection: z.enum(['connected', 'closed', 'lost', 'disconnected']),
  execution: z.enum([
    'idle',
    'queued',
    'running',
    'waiting',
    'completed',
    'failed',
    'cancelled',
    'interrupted',
    'unknown',
  ]),
  attention: z.enum(['none', 'approval', 'delivery_uncertain', 'error']),
  attemptId: z.string().optional(),
  runtimeId: z.string().optional(),
  eventId: z.number().optional(),
  error: sessionExecutionErrorSchema.optional(),
  timings: turnTimingsSchema.optional(),
  queue: z.array(
    z.object({
      id: z.string(),
      eventId: z.number(),
      text: z.string(),
      attachmentIds: z.array(z.string()),
      status: z.enum(['queued', 'unknown']),
    }),
  ),
});
export type SessionExecution = z.infer<typeof sessionExecutionSchema>;
