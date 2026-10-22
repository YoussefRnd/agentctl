import { attachmentSchema } from './attachments.js';
import { planArtifactSchema, planItemSchema } from './plan.js';
import { fileChangeStatsSchema } from './file-change.js';
import { z } from 'zod';
import { chatErrorSchema } from './chat-error.js';

export const sessionEventTextDataSchema = z
  .object({
    content: z.string().optional().default(''),
    text: z.string().optional(),
    role: z.enum(['provider', 'user', 'thought', 'session']).optional(),
    // Local optimistic user events use these fields until a persisted row arrives.
    deliveryStatus: z
      .enum(['queued', 'sending', 'accepted', 'failed', 'unknown', 'cancelled'])
      .optional(),
    deliveryError: z.string().optional(),
    deliveryFailure: chatErrorSchema.optional(),
    attachmentIds: z.array(z.string()).optional(),
    clientMessageId: z.string().optional(),
    messageId: z.string().optional(),
    transcriptSessionId: z.string().optional(),
    senderSessionId: z.string().optional(),
    recipientSessionId: z.string().optional(),
    attachments: z.array(attachmentSchema).optional(),
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
    status: z.string().optional(),
    kind: z.string().optional(),
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
            stats: fileChangeStatsSchema.optional(),
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
            stats: fileChangeStatsSchema.optional(),
          }),
          z.object({
            type: z.literal('file_deleted'),
            path: z.string(),
            stats: fileChangeStatsSchema.optional(),
          }),
          z.object({ type: z.literal('terminal'), terminalId: z.string() }),
        ]),
      )
      .optional(),
    /** Compact history summary of structured diffs; complete patches stay in event details. */
    fileChanges: z
      .array(
        z.object({
          operation: z.enum(['add', 'modify', 'delete']),
          path: z.string(),
          stats: fileChangeStatsSchema.optional(),
        }),
      )
      .optional(),
    rawInput: z.unknown().optional(),
    rawOutput: z.unknown().optional(),
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
    native: z.boolean().optional(),
    parentSessionId: z.string().optional(),
    historical: z.boolean().optional(),
    state: z.object({ state: z.string() }).loose().nullable().optional(),
    capabilities: z.record(z.string(), z.unknown()).nullable().optional(),
    name: z.string(),
    scope: z.string(),
    status: z.enum([
      'spawning',
      'pending',
      'running',
      'waiting',
      'completed',
      'failed',
      'cancelled',
      'interrupted',
      'unknown',
      'idle',
    ]),
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
    artifacts: z.array(planArtifactSchema).optional(),
    plan: z.array(planItemSchema),
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
    operation: z.enum(['append', 'replace']).optional(),
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

export const providerRetryStatusSchema = z.object({
  attempt: z.number().int().min(1),
  nextRetryAt: z.string().refine((value) => Number.isFinite(Date.parse(value))),
  message: z.string().max(512),
  httpStatus: z.number().int().min(100).max(599).optional(),
});
export type ProviderRetryStatus = z.infer<typeof providerRetryStatusSchema>;
export const sessionEventCompactDataSchema = z.record(z.string(), z.unknown());

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
