import { sessionEventDbRowSchema, type SessionEventDbRow } from '@agentctl/core/db';
import { sessionEventRowSchema, type SessionEventRow } from '@agentctl/shared';

export function parseEventRow(raw: SessionEventDbRow): SessionEventRow {
  const row = sessionEventDbRowSchema.parse(raw);
  return sessionEventRowSchema.parse({
    ...row,
    data: typeof row.data === 'string' ? JSON.parse(row.data) : row.data,
    metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : undefined,
  });
}
