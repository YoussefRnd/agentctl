import { z } from 'zod';

export const searchEventTypeSchema = z.enum(['user', 'agent', 'tool', 'thought']);
export type SearchEventType = z.infer<typeof searchEventTypeSchema>;

export const searchResultItemSchema = z.object({
  eventId: z.number(),
  sessionId: z.string(),
  sessionTitle: z.string(),
  projectId: z.string(),
  projectName: z.string(),
  eventType: searchEventTypeSchema,
  snippet: z.string(),
  matchIndices: z.tuple([z.number(), z.number()]),
  createdAt: z.string(),
});

export type SearchResultItem = z.infer<typeof searchResultItemSchema>;

export const searchContract = {
  searchEvents: {
    method: 'GET',
    path: '/api/search/events',
    query: z.object({
      q: z.string().min(1),
      type: searchEventTypeSchema.or(z.literal('all')).optional(),
      projectId: z.string().optional(),
      sessionId: z.string().optional(),
      limit: z.coerce.number().int().min(1).max(100).optional(),
    }),
    responses: {
      200: z.array(searchResultItemSchema),
    },
    summary: 'Search session event transcripts',
  },
} as const;
