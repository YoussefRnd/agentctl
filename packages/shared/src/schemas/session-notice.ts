import { z } from 'zod';

/** Live presentation only; notices do not participate in history or turn state. */
export const sessionNoticeSchema = z.object({
  type: z.literal('notice'),
  sessionId: z.uuid(),
  severity: z.string(),
  title: z.string().min(1),
  description: z.string().optional(),
  subagentId: z.string().optional(),
});
export type SessionNotice = z.infer<typeof sessionNoticeSchema>;
