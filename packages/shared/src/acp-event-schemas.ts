import { z } from 'zod';

export const acpEventTextDataSchema = z.object({
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

export const acpEventToolCallDataSchema = z
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
    rawInput: z.record(z.string(), z.unknown()).optional(),
    rawOutput: z.record(z.string(), z.unknown()).optional(),
  })
  .loose();

export const acpEventApprovalRequestDataSchema = z.object({
  message: z.string().optional(),
  toolCallId: z.string().optional(),
  request: z.unknown().optional(),
});

export const acpEventSubagentUpdateDataSchema = z.object({
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

export const acpEventPlanDataSchema = z.object({
  plan: z.array(
    z.object({
      name: z.string(),
      status: z.string(),
      isCompleted: z.boolean(),
      priority: z.enum(['high', 'medium', 'low']).optional(),
    }),
  ),
});

export const acpEventModeDataSchema = z.object({
  mode: z.string(),
});

export const acpEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('text'),
    data: acpEventTextDataSchema,
    createdAt: z.coerce.date(),
  }),
  z.object({
    type: z.literal('tool_call'),
    data: acpEventToolCallDataSchema,
    createdAt: z.coerce.date(),
  }),
  z.object({
    type: z.literal('approval_request'),
    data: acpEventApprovalRequestDataSchema,
    createdAt: z.coerce.date(),
  }),
  z.object({
    type: z.literal('plan_update'),
    data: acpEventPlanDataSchema,
    createdAt: z.coerce.date(),
  }),
  z.object({
    type: z.literal('mode_update'),
    data: acpEventModeDataSchema,
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
    data: acpEventSubagentUpdateDataSchema,
    createdAt: z.coerce.date(),
  }),
]);

export type ACPEvent = z.infer<typeof acpEventSchema>;
export type ACPEventTextData = z.infer<typeof acpEventTextDataSchema>;
export type ACPEventToolCallData = z.infer<typeof acpEventToolCallDataSchema>;
export type ACPEventApprovalRequestData = z.infer<typeof acpEventApprovalRequestDataSchema>;
export type ACPEventSubagentUpdateData = z.infer<typeof acpEventSubagentUpdateDataSchema>;

export const acpEventMetadataSchema = z.object({
  durationMs: z.number().optional(),
  promptTokens: z.number().optional(),
  completionTokens: z.number().optional(),
  cost: z.number().optional(),
  snapshotHash: z.string().optional(),
});

export const acpEventRowSchema = z.intersection(
  acpEventSchema,
  z.object({
    id: z.number(),
    sessionId: z.uuid(),
    parentEventId: z.number().nullable().optional(),
    metadata: acpEventMetadataSchema.optional(),
  }),
);

export type ACPEventRow = z.infer<typeof acpEventRowSchema>;
