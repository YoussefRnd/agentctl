import { z } from 'zod';

export const sessionEventTextDataSchema = z
  .object({
    content: z.string().optional().default(''),
    text: z.string().optional(),
    role: z.enum(['provider', 'user', 'thought']).optional(),
    // Local optimistic user events use these fields until a persisted row arrives.
    deliveryStatus: z.enum(['queued', 'sending', 'accepted', 'failed']).optional(),
    deliveryError: z.string().optional(),
    attachmentIds: z.array(z.string()).optional(),
    clientMessageId: z.string().optional(),
    attachments: z
      .array(
        z.object({
          attachmentId: z.string(),
          mimeType: z.string(),
          filename: z.string(),
          sizeBytes: z.number(),
        }),
      )
      .optional(),
  })
  .transform((val) => ({
    ...val,
    content:
      val.content !== undefined && val.content !== ''
        ? val.content
        : (val.text ?? val.content ?? ''),
  }));

export const sessionEventToolCallDataSchema = z
  .object({
    name: z.string().optional().default(''),
    arguments: z.record(z.string(), z.unknown()).optional(),
    toolCallId: z.string().optional(),
    title: z.string().optional(),
    status: z.enum(['pending', 'in_progress', 'completed', 'failed']).optional(),
    kind: z
      .enum(['read', 'edit', 'delete', 'move', 'search', 'execute', 'think', 'fetch', 'other'])
      .optional(),
    locations: z
      .array(
        z.object({
          path: z.string().optional(),
          line: z.number().optional(),
        }),
      )
      .optional(),
    content: z
      .array(
        z
          .object({
            type: z.enum(['content', 'diff', 'terminal']),
            content: z
              .object({
                type: z.string().optional(),
                text: z.string().optional(),
              })
              .loose()
              .optional(),
            path: z.string().optional(),
            oldText: z.string().nullable().optional(),
            newText: z.string().optional(),
            terminalId: z.string().optional(),
          })
          .loose(),
      )
      .optional(),
    effects: z
      .array(
        z.discriminatedUnion('type', [
          z.object({ type: z.literal('file_read'), path: z.string() }),
          z.object({
            type: z.literal('file_modified'),
            path: z.string(),
            oldText: z.string().nullable().optional(),
            newText: z.string().optional(),
          }),
          z.object({ type: z.literal('file_deleted'), path: z.string() }),
          z.object({ type: z.literal('terminal'), terminalId: z.string() }),
        ]),
      )
      .optional(),
    rawInput: z.record(z.string(), z.unknown()).optional(),
    rawOutput: z.record(z.string(), z.unknown()).optional(),
  })
  .loose();

export const sessionEventApprovalRequestDataSchema = z
  .object({
    message: z.string().optional(),
    toolCallId: z.string().optional(),
    request: z.unknown().optional(),
  })
  .loose();

export const sessionEventSubagentUpdateDataSchema = z
  .object({
    subagentId: z.string(),
    name: z.string(),
    scope: z.string(),
    status: z.enum(['spawning', 'running', 'completed', 'failed']),
    result: z
      .object({
        summary: z.string().optional(),
        tokensUsed: z.number().optional(),
      })
      .optional(),
  })
  .loose();

export const sessionEventPlanDataSchema = z
  .object({
    plan: z.array(
      z.object({
        name: z.string(),
        status: z.string(),
        isCompleted: z.boolean(),
        priority: z.enum(['high', 'medium', 'low']).optional(),
      }),
    ),
  })
  .loose();

export const sessionEventModeDataSchema = z
  .object({
    mode: z.string(),
  })
  .loose();

export const sessionEventTerminalCreatedDataSchema = z
  .object({
    terminalId: z.string(),
    command: z.string(),
  })
  .loose();

export const sessionEventTerminalOutputDataSchema = z
  .object({
    terminalId: z.string(),
    data: z.string(),
  })
  .loose();

export const sessionEventTerminalExitDataSchema = z
  .object({
    terminalId: z.string(),
    code: z.number().nullable(),
  })
  .loose();

export const sessionEventDiffDataSchema = z.record(z.string(), z.unknown());
export const sessionEventStatusDataSchema = z.record(z.string(), z.unknown());
export const sessionEventCompactDataSchema = z.record(z.string(), z.unknown());

export const sessionEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('text'),
    data: sessionEventTextDataSchema,
    createdAt: z.coerce.date(),
  }),
  z.object({
    type: z.literal('tool_call'),
    data: sessionEventToolCallDataSchema,
    createdAt: z.coerce.date(),
  }),
  z.object({
    type: z.literal('approval_request'),
    data: sessionEventApprovalRequestDataSchema,
    createdAt: z.coerce.date(),
  }),
  z.object({
    type: z.literal('plan_update'),
    data: sessionEventPlanDataSchema,
    createdAt: z.coerce.date(),
  }),
  z.object({
    type: z.literal('mode_update'),
    data: sessionEventModeDataSchema,
    createdAt: z.coerce.date(),
  }),
  z.object({
    type: z.literal('terminal_created'),
    data: sessionEventTerminalCreatedDataSchema,
    createdAt: z.coerce.date(),
  }),
  z.object({
    type: z.literal('terminal_output'),
    data: sessionEventTerminalOutputDataSchema,
    createdAt: z.coerce.date(),
  }),
  z.object({
    type: z.literal('terminal_exit'),
    data: sessionEventTerminalExitDataSchema,
    createdAt: z.coerce.date(),
  }),
  z.object({
    type: z.literal('diff'),
    data: sessionEventDiffDataSchema,
    createdAt: z.coerce.date(),
  }),
  z.object({
    type: z.literal('status'),
    data: sessionEventStatusDataSchema,
    createdAt: z.coerce.date(),
  }),
  z.object({
    type: z.literal('compact'),
    data: sessionEventCompactDataSchema,
    createdAt: z.coerce.date(),
  }),
  z.object({
    type: z.literal('subagent_update'),
    data: sessionEventSubagentUpdateDataSchema,
    createdAt: z.coerce.date(),
  }),
]);

export type SessionEvent = z.infer<typeof sessionEventSchema>;
export type SessionEventTextData = z.infer<typeof sessionEventTextDataSchema>;
export type SessionEventToolCallData = z.infer<typeof sessionEventToolCallDataSchema>;
export type SessionEventApprovalRequestData = z.infer<typeof sessionEventApprovalRequestDataSchema>;
export type SessionEventSubagentUpdateData = z.infer<typeof sessionEventSubagentUpdateDataSchema>;
export type SessionEventPlanData = z.infer<typeof sessionEventPlanDataSchema>;
export type SessionEventModeData = z.infer<typeof sessionEventModeDataSchema>;
export type SessionEventTerminalCreatedData = z.infer<typeof sessionEventTerminalCreatedDataSchema>;
export type SessionEventTerminalOutputData = z.infer<typeof sessionEventTerminalOutputDataSchema>;
export type SessionEventTerminalExitData = z.infer<typeof sessionEventTerminalExitDataSchema>;
export type SessionEventDiffData = z.infer<typeof sessionEventDiffDataSchema>;
export type SessionEventStatusData = z.infer<typeof sessionEventStatusDataSchema>;
export type SessionEventCompactData = z.infer<typeof sessionEventCompactDataSchema>;

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
    durationMs: z.number().optional(),
    promptTokens: z.number().optional(),
    completionTokens: z.number().optional(),
    cost: z.number().optional(),
    snapshotHash: z.string().optional(),
  })
  .loose();

export type SessionEventMetadata = z.infer<typeof sessionEventMetadataSchema>;

export const sessionEventRowSchema = z.intersection(
  sessionEventSchema,
  z.object({
    id: z.number(),
    sessionId: z.uuid(),
    parentEventId: z.number().nullable().optional(),
    metadata: sessionEventMetadataSchema.optional(),
    /**
     * Wire-only field carried on transient (non-persisted) streaming events.
     * When present, the client appends `delta` to the existing event content
     * instead of replacing it. Persisted rows never include this field.
     */
    delta: z.string().optional(),
  }),
);

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
