import { and, eq } from 'drizzle-orm';
import { sessionEvents } from '../../db/schema.js';
import { sessionOperations } from '../../db/schema.js';
import { createHash } from 'node:crypto';
import type { DbClient } from '../../db/index.js';

/** Stable acceptance receipts survive server restarts and lost HTTP responses. */
export class MessageAcceptanceService {
  private pending = new Map<string, { fingerprint: string; promise: Promise<number> }>();
  constructor(private db: DbClient) {}

  accept(
    sessionId: string,
    input: string,
    attachmentIds: string[] | undefined,
    clientMessageId: string | undefined,
    deliver: () => Promise<number>,
  ): Promise<number> {
    if (!clientMessageId) return deliver();
    const key = `${sessionId}:${clientMessageId}`;
    const fingerprint = JSON.stringify([input, attachmentIds ?? []]);
    const pending = this.pending.get(key);
    if (pending)
      return pending.fingerprint === fingerprint
        ? pending.promise
        : Promise.reject(new Error('Message ID was reused with different content'));
    const promise = (async () => {
      const receipt = await this.findReceipt(sessionId, clientMessageId, input, attachmentIds);
      if (receipt !== undefined) return receipt;
      try {
        return await deliver();
      } catch (error) {
        // Another server may have persisted the same unique receipt concurrently.
        const receipt = await this.findReceipt(sessionId, clientMessageId, input, attachmentIds);
        if (receipt !== undefined) return receipt;
        throw error;
      }
    })();
    this.pending.set(key, { fingerprint, promise });
    void promise
      .finally(() => {
        if (this.pending.get(key)?.promise === promise) this.pending.delete(key);
      })
      .catch(() => undefined);
    return promise;
  }

  async findReceipt(
    sessionId: string,
    id: string,
    input: string,
    attachmentIds?: string[],
  ): Promise<number | undefined> {
    const row = await this.db.query.sessionEvents.findFirst({
      where: and(
        eq(sessionEvents.sessionId, sessionId),
        eq(sessionEvents.type, 'text'),
        eq(sessionEvents.clientMessageId, id),
      ),
    });
    if (!row) return undefined;
    const data = JSON.parse(row.data) as { content: string; attachmentIds?: string[] };
    if (
      data.content !== input ||
      JSON.stringify(data.attachmentIds ?? []) !== JSON.stringify(attachmentIds ?? [])
    ) {
      // Queue edits change the dispatch payload, but the original acceptance
      // receipt must still acknowledge retries of a lost HTTP response.
      const operation = await this.db.query.sessionOperations.findFirst({
        where: and(eq(sessionOperations.sessionId, sessionId), eq(sessionOperations.commandId, id)),
      });
      const fingerprint = createHash('sha256')
        .update(JSON.stringify([input, attachmentIds ?? []]))
        .digest('hex');
      if (operation?.kind !== 'message.send' || operation.fingerprint !== fingerprint)
        throw new Error('Message ID was reused with different content');
    }
    return row.id;
  }
}
