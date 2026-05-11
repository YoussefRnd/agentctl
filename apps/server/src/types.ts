import { z } from 'zod';
import type { ACPEvent } from '@agentctl/shared';

// Defines a row exactly as it comes from the DB
export interface ACPEventRow extends Omit<ACPEvent, 'createdAt'> {
  id: number;
  sessionId: string;
  createdAt: Date;
}

export const wsSubscribeMessageSchema = z.object({
  action: z.literal('subscribe'),
  sessionId: z.string().uuid(),
  lastEventId: z.number().optional(),
});

export type WSSubscribeMessage = z.infer<typeof wsSubscribeMessageSchema>;

export interface WSOutgoingMessage {
  type: 'acp_event';
  payload: ACPEventRow;
}
