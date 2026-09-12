import { eq, asc, and } from 'drizzle-orm';
import type { DbClient } from '../db/index.js';
import { acpEvents } from '../db/schema.js';
import { getContextTurnLimit } from '../config/runtime-defaults.js';

export interface HistoryTranscriptOptions {
  maxTurns?: number;
}

export async function buildConversationHistoryTranscript(
  db: DbClient,
  sessionId: string,
  options: HistoryTranscriptOptions = {},
): Promise<string | null> {
  const maxTurns = options.maxTurns ?? getContextTurnLimit();

  const rows = await db
    .select()
    .from(acpEvents)
    .where(and(eq(acpEvents.sessionId, sessionId), eq(acpEvents.type, 'text')))
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

      if (data.role === 'user') {
        conversationEntries.push({ role: 'User', text: textVal });
      } else if (data.role !== 'thought') {
        conversationEntries.push({ role: 'Assistant', text: textVal });
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
