import { z } from 'zod';

export const acpEventTextDataSchema = z.object({
  content: z.string(),
});

export const acpEventToolCallDataSchema = z
  .object({
    name: z.string(),
    arguments: z.record(z.string(), z.any()).optional(),
    toolCallId: z.string().optional(),
  })
  .loose();

export const acpEventApprovalRequestDataSchema = z.object({
  message: z.string().optional(),
  toolCallId: z.string().optional(),
  request: z.any().optional(),
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
    type: z.literal('diff'),
    data: z.record(z.string(), z.any()),
    createdAt: z.coerce.date(),
  }),
  z.object({
    type: z.literal('status'),
    data: z.record(z.string(), z.any()),
    createdAt: z.coerce.date(),
  }),
  z.object({
    type: z.literal('compact'),
    data: z.record(z.string(), z.any()),
    createdAt: z.coerce.date(),
  }),
]);

export type ACPEvent = z.infer<typeof acpEventSchema>;
export type ACPEventTextData = z.infer<typeof acpEventTextDataSchema>;
export type ACPEventToolCallData = z.infer<typeof acpEventToolCallDataSchema>;
export type ACPEventApprovalRequestData = z.infer<typeof acpEventApprovalRequestDataSchema>;

export type ACPEventRow = ACPEvent & {
  id: number;
  sessionId: string;
};
