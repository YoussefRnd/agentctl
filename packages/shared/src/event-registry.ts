import { z } from 'zod';
import { acpEventRowSchema } from './acp-event-schemas.js';

/**
 * EventRegistry defines all possible WebSocket events and their payloads.
 * This acts as the single source of truth for the WebSocket contract.
 */
export const EventRegistry = {
  // Server-to-Client Events
  acp_event: acpEventRowSchema,
  error: z.object({
    error: z.string(),
  }),

  // Client-to-Server Events (Actions)
  subscribe: z.object({
    sessionId: z.uuid(),
    lastEventId: z.number().optional(),
  }),
  approve: z.object({
    sessionId: z.uuid(),
    eventId: z.number(),
    optionId: z.string().optional(),
  }),
  deny: z.object({
    sessionId: z.uuid(),
    eventId: z.number(),
  }),
  'session.input': z.object({
    sessionId: z.uuid(),
    input: z.string(),
    attachmentIds: z.array(z.string()).optional(),
  }),
} as const;

export type EventName = keyof typeof EventRegistry;

export type EventPayload<T extends EventName> = z.infer<(typeof EventRegistry)[T]>;

/**
 * Helper to create a validated event object for transmission.
 */
export function createEvent<T extends EventName>(type: T, payload: EventPayload<T>) {
  // Validate at runtime to catch issues early
  return JSON.stringify({
    type,
    ...(type === 'acp_event' ? { payload } : payload),
  });
}

/**
 * Incoming message schema for client actions (what server receives)
 */
export const clientActionSchema = z.discriminatedUnion('action', [
  EventRegistry.subscribe.extend({ action: z.literal('subscribe') }),
  EventRegistry.approve.extend({ action: z.literal('approve') }),
  EventRegistry.deny.extend({ action: z.literal('deny') }),
  EventRegistry['session.input'].extend({ action: z.literal('session.input') }),
]);

export type ClientAction = z.infer<typeof clientActionSchema>;

/**
 * Incoming message schema for server events (what client receives)
 */
export const serverEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('acp_event'), payload: acpEventRowSchema }),
  EventRegistry.error.extend({ type: z.literal('error') }),
]);

export type ServerEvent = z.infer<typeof serverEventSchema>;
