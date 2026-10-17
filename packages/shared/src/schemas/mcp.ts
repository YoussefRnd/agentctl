import { z } from 'zod';
export const mcpToolResultSchema = z
  .object({
    content: z.array(
      z
        .object({
          type: z.string(),
          text: z.string().optional(),
        })
        .loose(),
    ),
    isError: z.boolean().optional(),
  })
  .loose();

export type McpToolResult = z.infer<typeof mcpToolResultSchema>;
