import { eq, asc, inArray, and } from 'drizzle-orm';
import type { DbClient } from '../acp/session-client.js';
import { acpEvents } from '../db/schema.js';

export interface HistoryTranscriptOptions {
  maxTurns?: number;
}

export async function buildConversationHistoryTranscript(
  db: DbClient,
  sessionId: string,
  options: HistoryTranscriptOptions = {},
): Promise<string | null> {
  const maxTurns = options.maxTurns ?? 10;

  const rows = await db
    .select()
    .from(acpEvents)
    .where(
      and(
        eq(acpEvents.sessionId, sessionId),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        inArray(acpEvents.type as any, ['user_message', 'text']),
      ),
    )
    .orderBy(asc(acpEvents.id));

  const conversationEntries: { role: 'User' | 'Assistant'; text: string }[] = [];

  for (const row of rows) {
    if (!row.data) continue;
    try {
      const data = (typeof row.data === 'string' ? JSON.parse(row.data) : row.data) as {
        text?: string;
        content?: string;
        role?: string;
      };
      const textVal = (data.content ?? data.text)?.trim();
      if (!textVal) continue;

      const typeStr = row.type as string;
      if (data.role === 'user' || typeStr === 'user_message') {
        conversationEntries.push({ role: 'User', text: textVal });
      } else if (data.role === 'provider' || data.role === 'assistant' || typeStr === 'text') {
        if (data.role !== 'thought') {
          conversationEntries.push({ role: 'Assistant', text: textVal });
        }
      }
    } catch {
      // Ignore unparseable event data
    }
  }

  if (conversationEntries.length === 0) {
    return null;
  }

  const recentEntries = conversationEntries.slice(-maxTurns);

  const lines = recentEntries.map((e) => `[${e.role}]: ${e.text}`);

  return `<previous_conversation_context>\nThe user was previously conversing in this workspace session. Here is the recent conversation transcript:\n\n${lines.join(
    '\n\n',
  )}\n</previous_conversation_context>`;
}
