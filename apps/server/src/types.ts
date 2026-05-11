import { z } from 'zod';
import type { ACPEvent } from '@agentctl/shared';

// Defines a row exactly as it comes from the DB
export interface ACPEventRow extends Omit<ACPEvent, 'createdAt'> {
  id: number;
  sessionId: string;
  createdAt: Date;
}

export const wsMessageSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('subscribe'),
    sessionId: z.uuid(),
    lastEventId: z.number().optional(),
  }),
  z.object({
    action: z.literal('approve'),
    sessionId: z.uuid(),
    eventId: z.number(),
  }),
  z.object({
    action: z.literal('deny'),
    sessionId: z.uuid(),
    eventId: z.number(),
  }),
  z.object({
    action: z.literal('session.input'),
    sessionId: z.uuid(),
    input: z.string(),
  }),
]);

export type WSClientMessage = z.infer<typeof wsMessageSchema>;

export interface WSOutgoingMessage {
  type: 'acp_event';
  payload: ACPEventRow;
}
