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
  return z.discriminatedUnion('type', [
    z.object({
      ...common,
      type: z.literal('text'),
      data: sessionEventTextDataSchema,
    }),
    z.object({
      ...common,
      type: z.literal('tool_call'),
      data: sessionEventToolCallDataSchema,
    }),
    z.object({
      ...common,
      type: z.literal('approval_request'),
      data: sessionEventApprovalRequestDataSchema,
    }),
    z.object({
      ...common,
      type: z.literal('plan_update'),
      data: sessionEventPlanDataSchema,
    }),
    z.object({
      ...common,
      type: z.literal('mode_update'),
      data: sessionEventModeDataSchema,
    }),
    z.object({
      ...common,
      type: z.literal('terminal_created'),
      data: sessionEventTerminalCreatedDataSchema,
    }),
    z.object({
      ...common,
      type: z.literal('terminal_output'),
      data: sessionEventTerminalOutputDataSchema,
    }),
    z.object({
      ...common,
      type: z.literal('terminal_exit'),
      data: sessionEventTerminalExitDataSchema,
    }),
    z.object({
      ...common,
      type: z.literal('diff'),
      data: sessionEventDiffDataSchema,
    }),
    z.object({
      ...common,
      type: z.literal('status'),
      data: sessionEventStatusDataSchema,
    }),
    z.object({
      ...common,
      type: z.literal('compact'),
      data: sessionEventCompactDataSchema,
    }),
    z.object({
      ...common,
      type: z.literal('subagent_update'),
      data: sessionEventSubagentUpdateDataSchema,
    }),
  ]);
}

export const sessionEventSchema = createSessionEventSchema({});

export type SessionEvent = z.infer<typeof sessionEventSchema>;

export interface SessionEventPayloadMap {
  text: z.input<typeof sessionEventTextDataSchema>;
  tool_call: z.input<typeof sessionEventToolCallDataSchema>;
  approval_request: z.input<typeof sessionEventApprovalRequestDataSchema>;
  plan_update: z.input<typeof sessionEventPlanDataSchema>;
  mode_update: z.input<typeof sessionEventModeDataSchema>;
  terminal_created: z.input<typeof sessionEventTerminalCreatedDataSchema>;
  terminal_output: z.input<typeof sessionEventTerminalOutputDataSchema>;
  terminal_exit: z.input<typeof sessionEventTerminalExitDataSchema>;
  diff: Record<string, unknown>;
  status: Record<string, unknown>;
  compact: Record<string, unknown>;
  subagent_update: z.input<typeof sessionEventSubagentUpdateDataSchema>;
}

export type SessionEventType = keyof SessionEventPayloadMap;
export type SessionEventPayload<T extends string> = T extends SessionEventType
  ? SessionEventPayloadMap[T]
  : Record<string, unknown>;

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

// Type Guard Utilities
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
