import { z } from 'zod';
export const elicitationFormFieldSchema = z.object({
  id: z.string(),
  label: z.string(),
  description: z.string().optional(),
  type: z
    .enum(['string', 'number', 'integer', 'boolean', 'select', 'multi_select'])
    .default('string'),
  default: z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]).optional(),
  required: z.boolean().optional().default(false),
  minimum: z.number().optional(),
  maximum: z.number().optional(),
  minLength: z.number().int().nonnegative().optional(),
  maxLength: z.number().int().nonnegative().optional(),
  pattern: z.string().optional(),
  format: z.enum(['email', 'uri', 'date', 'date-time']).optional(),
  minItems: z.number().int().nonnegative().optional(),
  maxItems: z.number().int().nonnegative().optional(),
  options: z
    .array(
      z.object({
        label: z.string(),
        value: z.string(),
        description: z.string().optional(),
      }),
    )
    .optional(),
});

export const formElicitationSchema = z.object({
  title: z.string().optional(),
  description: z.string().optional(),
  fields: z.array(elicitationFormFieldSchema),
});

export const urlElicitationSchema = z.object({
  url: z.string(),
  title: z.string().optional(),
  description: z.string().optional(),
});

export const elicitationRequestSchema = z.object({
  subagentId: z.string().optional(),
  id: z.string(),
  mode: z.enum(['form', 'url']),
  message: z.string(),
  sessionId: z.string().optional(),
  requestId: z.union([z.string(), z.number()]).optional(),
  toolCallId: z.string().optional(),
  form: formElicitationSchema.optional(),
  url: urlElicitationSchema.optional(),
});

export const elicitationResponseSchema = z.object({
  action: z.enum(['submit', 'decline', 'cancel']),
  values: z.record(z.string(), z.unknown()).optional(),
});

export const elicitationItemSchema = z.object({
  id: z.string(),
  request: elicitationRequestSchema,
  status: z.enum(['pending', 'completed', 'declined', 'cancelled']),
  createdAt: z.string(),
  response: elicitationResponseSchema.optional(),
});

export type ElicitationFormField = z.infer<typeof elicitationFormFieldSchema>;
export type FormElicitation = z.infer<typeof formElicitationSchema>;
export type UrlElicitation = z.infer<typeof urlElicitationSchema>;
export type ElicitationRequest = z.infer<typeof elicitationRequestSchema>;
export type ElicitationResponse = z.infer<typeof elicitationResponseSchema>;
export type ElicitationItem = z.infer<typeof elicitationItemSchema>;
