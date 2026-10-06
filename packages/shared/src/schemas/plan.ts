import { z } from 'zod';

export const planItemSchema = z.object({
  name: z.string(),
  status: z.string(),
  isCompleted: z.boolean(),
  priority: z.string().optional(),
});
export const planArtifactSchema = z.object({
  id: z.string(),
  kind: z.enum(['items', 'markdown', 'file', 'unknown']),
  items: z.array(planItemSchema).optional(),
  markdown: z.string().optional(),
  uri: z.string().optional(),
  contentType: z.string().optional(),
});
export type PlanArtifact = z.infer<typeof planArtifactSchema>;

export type PlanItem = z.infer<typeof planItemSchema>;
