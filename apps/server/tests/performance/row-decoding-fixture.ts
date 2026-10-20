import { z } from 'zod';
import { sessionEventDbRowSchema, type SessionEventDbRow } from '@agentctl/core/db';
import { sessionEventSchema, sessionEventMetadataSchema } from '@agentctl/shared';

// Preserved pre-optimization algorithm: a semantic oracle and same-process timing reference.
export const legacyEventRowSchema = z.intersection(
  sessionEventSchema,
  z.object({
    id: z.number(),
    sequence: z.number().int().nonnegative().optional(),
    sessionId: z.uuid(),
    parentEventId: z.number().nullable().optional(),
    metadata: sessionEventMetadataSchema.optional(),
    delta: z.string().optional(),
  }),
);

export function decodeLegacyRow(raw: SessionEventDbRow) {
  const row = sessionEventDbRowSchema.parse(raw);
  return legacyEventRowSchema.parse({
    ...row,
    data: JSON.parse(row.data),
    metadata: row.metadata === null ? undefined : JSON.parse(row.metadata),
  });
}

export const eventExamples = [
  { type: 'text', data: { role: 'provider', text: 'Synthetic history '.repeat(16) } },
  {
    type: 'tool_call',
    data: {
      toolCallId: 'tool',
      name: 'read',
      rawInput: { path: '/synthetic' },
      content: [{ type: 'content', content: { type: 'text', text: 'result '.repeat(128) } }],
    },
  },
  { type: 'approval_request', data: { message: 'Synthetic approval', request: { tool: 'read' } } },
  { type: 'plan_update', data: { plan: [] } },
  { type: 'mode_update', data: { mode: 'synthetic' } },
  { type: 'terminal_created', data: { terminalId: 'terminal', command: 'synthetic' } },
  { type: 'terminal_output', data: { terminalId: 'terminal', data: 'output '.repeat(64) } },
  { type: 'terminal_exit', data: { terminalId: 'terminal', code: null } },
  { type: 'diff', data: { path: '/synthetic/file', patch: '+ synthetic' } },
  { type: 'status', data: { status: 'turn_end' } },
  { type: 'compact', data: { phase: 'complete' } },
  {
    type: 'subagent_update',
    data: { subagentId: 'child', name: 'Child', scope: 'Synthetic', status: 'running' },
  },
] as const;

export function decodingRows(count: number, mixed: boolean): SessionEventDbRow[] {
  return Array.from({ length: count }, (_, index) => {
    const event = eventExamples[mixed ? index % eventExamples.length : 0];
    return {
      id: index + 1,
      sessionId: '00000000-0000-4000-8000-000000000001',
      parentEventId: index > 0 ? 1 : null,
      type: event.type,
      data: JSON.stringify(event.data),
      metadata:
        index % 3 === 0
          ? JSON.stringify({
              attemptId: 'attempt',
              completionTokens: index,
              futureField: { retained: true },
            })
          : null,
      createdAt: new Date('2026-01-01T00:00:00Z'),
    };
  });
}
