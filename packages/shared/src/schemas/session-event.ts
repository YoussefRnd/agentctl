import { z } from 'zod';
import {
  sessionEventTextDataSchema,
  sessionEventToolCallDataSchema,
  sessionEventApprovalRequestDataSchema,
  sessionEventSubagentUpdateDataSchema,
  sessionEventPlanDataSchema,
  sessionEventModeDataSchema,
  sessionEventTerminalCreatedDataSchema,
  sessionEventTerminalOutputDataSchema,
  sessionEventTerminalExitDataSchema,
  sessionEventDiffDataSchema,
  sessionEventStatusDataSchema,
  sessionEventCompactDataSchema,
} from './session-event-payloads.js';
export * from './session-event-payloads.js';
function createSessionEventSchema<T extends z.ZodRawShape>(fields: T) {
  const common = { createdAt: z.coerce.date(), ...fields };
  const event = <Kind extends string, Data extends z.ZodType>(type: Kind, data: Data) =>
    z.object({ ...common, type: z.literal(type), data });
  return z.discriminatedUnion('type', [
    event('text', sessionEventTextDataSchema),
    event('tool_call', sessionEventToolCallDataSchema),
    event('approval_request', sessionEventApprovalRequestDataSchema),
    event('plan_update', sessionEventPlanDataSchema),
    event('mode_update', sessionEventModeDataSchema),
    event('terminal_created', sessionEventTerminalCreatedDataSchema),
    event('terminal_output', sessionEventTerminalOutputDataSchema),
    event('terminal_exit', sessionEventTerminalExitDataSchema),
    event('diff', sessionEventDiffDataSchema),
    event('status', sessionEventStatusDataSchema),
    event('compact', sessionEventCompactDataSchema),
    event('subagent_update', sessionEventSubagentUpdateDataSchema),
  ]);
}

export const sessionEventSchema = createSessionEventSchema({});

export type SessionEvent = z.infer<typeof sessionEventSchema>;

type SchemaPayloads = {
  [Event in z.input<typeof sessionEventSchema> as Event['type']]: Event['data'];
};

export interface SessionEventPayloadMap extends SchemaPayloads {}

export type SessionEventType = keyof SessionEventPayloadMap;
export type SessionEventPayload<T extends string> = T extends SessionEventType
  ? SessionEventPayloadMap[T]
  : Record<string, unknown>;

type EventVariant = (typeof sessionEventSchema.options)[number];
export const sessionEventPayloadSchemas = Object.freeze(
  Object.fromEntries(sessionEventSchema.options.map(({ shape }) => [shape.type.value, shape.data])),
) as {
  readonly [Event in EventVariant as Event['shape']['type']['value']]: Event['shape']['data'];
};

export const sessionEventMetadataSchema = z
  .object({
    nativeSessionId: z.string().optional(),
    attemptId: z.string().optional(),
    durationMs: z.number().optional(),
    promptTokens: z.number().optional(),
    completionTokens: z.number().optional(),
    cost: z.number().optional(),
    snapshotHash: z.string().optional(),
  })
  .loose();

export type SessionEventMetadata = z.infer<typeof sessionEventMetadataSchema>;

// Each variant validates its envelope and payload in one object pass. The factory keeps
// event/row contracts and discriminant narrowing aligned without an intersection merge.
export const sessionEventRowSchema = createSessionEventSchema({
  id: z.number(),
  sequence: z.number().int().nonnegative().optional(),
  sessionId: z.uuid(),
  parentEventId: z.number().nullable().optional(),
  metadata: sessionEventMetadataSchema.optional(),
  /** Wire-only marker: omitted output is available from the session-scoped detail endpoint. */
  details: z
    .object({
      revision: z.string().regex(/^[a-f0-9]{64}$/),
      outputBytes: z.number().int().nonnegative().optional(),
    })
    .optional(),
  /**
   * Wire-only field carried on transient (non-persisted) streaming events.
   * When present, the client appends `delta` to the existing event content
   * instead of replacing it. Persisted rows never include this field.
   */
  delta: z.string().optional(),
});

export type SessionEventRow = z.infer<typeof sessionEventRowSchema>;

export function isSessionEvent(event: unknown): event is SessionEvent {
  return sessionEventSchema.safeParse(event).success;
}

export function isSessionEventRow(event: unknown): event is SessionEventRow {
  return sessionEventRowSchema.safeParse(event).success;
}

export function isSessionEventText(
  event: SessionEvent,
): event is Extract<SessionEvent, { type: 'text' }> {
  return event.type === 'text';
}

export function isSessionEventToolCall(
  event: SessionEvent,
): event is Extract<SessionEvent, { type: 'tool_call' }> {
  return event.type === 'tool_call';
}

export function isSessionEventPlanUpdate(
  event: SessionEvent,
): event is Extract<SessionEvent, { type: 'plan_update' }> {
  return event.type === 'plan_update';
}

export function isSessionEventModeUpdate(
  event: SessionEvent,
): event is Extract<SessionEvent, { type: 'mode_update' }> {
  return event.type === 'mode_update';
}
export function isSessionEventSubagentUpdate(
  event: SessionEvent,
): event is Extract<SessionEvent, { type: 'subagent_update' }> {
  return event.type === 'subagent_update';
}
