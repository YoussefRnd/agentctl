import { z } from 'zod';
export const contextItemTypeSchema = z.enum(['file', 'folder', 'git', 'symbol']);
export const contextItemSchema = z.object({
  id: z.string(),
  type: contextItemTypeSchema,
  title: z.string(),
  subtitle: z.string(),
  value: z.string(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export const contextItemReferenceSchema = z.object({
  type: contextItemTypeSchema,
  value: z.string(),
  path: z.string().optional(),
  target: z.string().optional(),
});
export const resolvedContextResultSchema = z.object({
  formattedContent: z.string(),
  items: z.array(
    z.object({ id: z.string(), type: contextItemTypeSchema, title: z.string(), size: z.number() }),
  ),
});
export type ContextItemType = z.infer<typeof contextItemTypeSchema>;
export type ContextItem = z.infer<typeof contextItemSchema>;
export type ContextItemReference = z.infer<typeof contextItemReferenceSchema>;
export type ResolvedContextResult = z.infer<typeof resolvedContextResultSchema>;
