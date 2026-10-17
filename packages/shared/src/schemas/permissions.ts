import { z } from 'zod';
export const permissionOptionKindSchema = z.enum([
  'allow_once',
  'allow_always',
  'reject_once',
  'reject_always',
]);

export const permissionOptionSchema = z.object({
  option_id: z.string(),
  kind: permissionOptionKindSchema,
  name: z.string(),
  description: z.string().optional(),
});

export const permissionOptionChoiceSchema = z.object({
  allow: permissionOptionSchema,
  deny: permissionOptionSchema,
  sub_patterns: z.array(z.string()).default([]),
});

export const permissionPatternSchema = z.object({
  pattern: z.string(),
  display_name: z.string(),
});

export const permissionOptionsSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('flat'),
    options: z.array(permissionOptionSchema),
  }),
  z.object({
    type: z.literal('dropdown'),
    choices: z.array(permissionOptionChoiceSchema),
  }),
  z.object({
    type: z.literal('dropdown_with_patterns'),
    choices: z.array(permissionOptionChoiceSchema),
    patterns: z.array(permissionPatternSchema),
    tool_name: z.string(),
  }),
]);

export const selectedPermissionParamsSchema = z.object({
  patterns: z.array(z.string()).optional(),
});

export const selectedPermissionOutcomeSchema = z.object({
  option_id: z.string(),
  option_kind: permissionOptionKindSchema,
  params: selectedPermissionParamsSchema.optional(),
});

export type PermissionOptionKind = z.infer<typeof permissionOptionKindSchema>;
export type PermissionOption = z.infer<typeof permissionOptionSchema>;
export type PermissionOptionChoice = z.infer<typeof permissionOptionChoiceSchema>;
export type PermissionPattern = z.infer<typeof permissionPatternSchema>;
export type PermissionOptions = z.infer<typeof permissionOptionsSchema>;
export type SelectedPermissionParams = z.infer<typeof selectedPermissionParamsSchema>;
export type SelectedPermissionOutcome = z.infer<typeof selectedPermissionOutcomeSchema>;
