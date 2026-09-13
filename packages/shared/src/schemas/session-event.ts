import { z } from 'zod';

export const sessionEventTextDataSchema = z.object({
  content: z.string(),
  role: z.enum(['provider', 'user', 'thought']).optional(),
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
});

export const sessionEventToolCallDataSchema = z
  .object({
    name: z.string(),
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

export const sessionEventApprovalRequestDataSchema = z.object({
  message: z.string().optional(),
  toolCallId: z.string().optional(),
  request: z.unknown().optional(),
});

export const sessionEventSubagentUpdateDataSchema = z.object({
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
});

export const sessionEventPlanDataSchema = z.object({
  plan: z.array(
    z.object({
      name: z.string(),
      status: z.string(),
      isCompleted: z.boolean(),
      priority: z.enum(['high', 'medium', 'low']).optional(),
    }),
  ),
});

export const sessionEventModeDataSchema = z.object({
  mode: z.string(),
});

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
    data: z.object({
      terminalId: z.string(),
      command: z.string(),
    }),
    createdAt: z.coerce.date(),
  }),
  z.object({
    type: z.literal('terminal_output'),
    data: z.object({
      terminalId: z.string(),
      data: z.string(),
    }),
    createdAt: z.coerce.date(),
  }),
  z.object({
    type: z.literal('terminal_exit'),
    data: z.object({
      terminalId: z.string(),
      code: z.number().nullable(),
    }),
    createdAt: z.coerce.date(),
  }),
  z.object({
    type: z.literal('diff'),
    data: z.record(z.string(), z.unknown()),
    createdAt: z.coerce.date(),
  }),
  z.object({
    type: z.literal('status'),
    data: z.record(z.string(), z.unknown()),
    createdAt: z.coerce.date(),
  }),
  z.object({
    type: z.literal('compact'),
    data: z.record(z.string(), z.unknown()),
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

export const sessionEventMetadataSchema = z.object({
  durationMs: z.number().optional(),
  promptTokens: z.number().optional(),
  completionTokens: z.number().optional(),
  cost: z.number().optional(),
  snapshotHash: z.string().optional(),
});

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
