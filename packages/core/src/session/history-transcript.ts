import { registerContextFile } from './context-files.js';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { contextByteBudget, selectContextEntries } from './context-budget.js';
import { redactSensitiveText, scheduleHandoffCleanup } from './handoff.js';
import { eq, asc, and, lt } from 'drizzle-orm';
import type { DbClient } from '../db/index.js';
import { sessionEvents } from '../db/schema.js';
import { getContextTurnLimit } from '../config/runtime-defaults.js';

export interface HistoryTranscriptOptions {
  beforeEventId?: number;
  maxTurns?: number;
  contextWindow?: number;
  maxBytes?: number;
}

export async function buildConversationHistoryTranscript(
  db: DbClient,
  sessionId: string,
  options: HistoryTranscriptOptions = {},
): Promise<string | null> {
  const maxTurns = options.maxTurns ?? getContextTurnLimit();

  const rows = await db
    .select()
    .from(sessionEvents)
    .where(
      and(
        eq(sessionEvents.sessionId, sessionId),
        eq(sessionEvents.type, 'text'),
        options.beforeEventId !== undefined
          ? lt(sessionEvents.id, options.beforeEventId)
          : undefined,
      ),
    )
    .orderBy(asc(sessionEvents.id));

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

      if (
        data.role === 'user' &&
        ['queued', 'cancelled', 'failed', 'unknown'].includes(
          (data as { deliveryStatus?: string }).deliveryStatus ?? '',
        )
      )
        continue;
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

  const budget = options.maxBytes ?? contextByteBudget(options.contextWindow);
  const recentEntries = selectContextEntries(
    conversationEntries,
    Math.max(0, budget - 1024),
    maxTurns,
  );
  let retrieval = '';
  if (recentEntries.length < conversationEntries.length) {
    const filePath = path.join(os.tmpdir(), `agentctl-handoff-history-${randomUUID()}.md`);
    await fs.writeFile(
      filePath,
      redactSensitiveText(
        conversationEntries.map((entry) => `[${entry.role}]: ${entry.text}`).join('\n\n'),
      ),
      { mode: 0o600 },
    );
    registerContextFile(sessionId, filePath);
    scheduleHandoffCleanup(filePath);
    retrieval = `\n\n${conversationEntries.length - recentEntries.length} messages omitted to fit the context budget. Read the full persisted transcript at ${filePath} if needed.`;
  }

  const lines = recentEntries.map((e) => `[${e.role}]: ${e.text}`);

  const transcript = `<previous_conversation_context>\nThe user was previously conversing in this workspace session. Here is the recent conversation transcript:\n\n${lines.join(
    '\n\n',
  )}${retrieval}\n</previous_conversation_context>`;
  if (Buffer.byteLength(transcript) <= budget) return transcript;
  if (retrieval && Buffer.byteLength(retrieval) <= budget) return retrieval.trim();
  throw new Error('The context budget is too small to include a transcript reference');
}
