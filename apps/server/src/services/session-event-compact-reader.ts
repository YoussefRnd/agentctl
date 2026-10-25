import { sessionEventDbRowSchema, type SessionEventDbRow } from '@agentctl/core/db';
import type { SessionEventRow } from '@agentctl/shared';
import { parseEventRow } from './session-event-row.js';
import { SessionEventProjection } from './session-event-projection.js';
import { persistedEventFingerprint, eventDetailRevisionForRow } from './session-event-revision.js';

interface CompactEntry {
  fingerprint: string;
  encoded: string;
  revision: string;
  parentEventId: number | null;
  dataCharacters: number;
  metadataCharacters: number | null;
}

function sameEnvelope(entry: CompactEntry, row: SessionEventDbRow): boolean {
  return (
    entry.parentEventId === row.parentEventId &&
    entry.dataCharacters === row.data.length &&
    entry.metadataCharacters === (row.metadata?.length ?? null)
  );
}

/** Reuses validated compact JSON, without retaining decoded events or original payload strings. */
export class SessionEventCompactReader {
  private readonly entries = new Map<string, CompactEntry>();
  private characters = 0;

  constructor(
    private readonly project: (
      event: SessionEventRow,
      revision?: () => string,
    ) => SessionEventRow = new SessionEventProjection().compact,
  ) {}

  private remove(key: string) {
    const entry = this.entries.get(key);
    if (entry) {
      this.characters -= entry.encoded.length;
      this.entries.delete(key);
    }
  }

  private touch(key: string, entry: CompactEntry) {
    this.entries.delete(key);
    this.entries.set(key, entry);
  }

  encode = (raw: SessionEventDbRow): string => {
    if (raw.type !== 'tool_call' && raw.type !== 'terminal_output')
      return JSON.stringify(parseEventRow(raw));
    const row = sessionEventDbRowSchema.parse(raw);
    const key = `${row.sessionId}:${row.id}`;
    const entry = this.entries.get(key);
    let current = entry && sameEnvelope(entry, row) ? persistedEventFingerprint(row) : undefined;
    if (entry && entry.fingerprint === current) {
      this.touch(key, entry);
      return entry.encoded;
    }
    this.remove(key);
    const full = parseEventRow(row);
    const event = this.project(full, () => {
      const identity = eventDetailRevisionForRow(row, full, current);
      current = identity.fingerprint;
      return identity.revision;
    });
    const encoded = JSON.stringify(event);
    // Unknown/live output stays uncached. Large inputs/extensions must not grow this cache.
    if (event.details && encoded.length <= 8_192) {
      this.entries.set(key, {
        fingerprint: current ?? persistedEventFingerprint(row),
        parentEventId: row.parentEventId,
        dataCharacters: row.data.length,
        metadataCharacters: row.metadata?.length ?? null,
        encoded,
        revision: event.details.revision,
      });
      this.characters += encoded.length;
      // At most 1 MiB of UTF-16 payloads, plus entry/key/digest overhead bounded by the count.
      while (this.entries.size > 1_024 || this.characters > 524_288)
        this.remove(this.entries.keys().next().value!);
    }
    return encoded;
  };

  /** Full detail still decodes its current row; reuse only the matching canonical revision. */
  revision(raw: SessionEventDbRow): string | undefined {
    const row = sessionEventDbRowSchema.parse(raw);
    const key = `${row.sessionId}:${row.id}`;
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (!sameEnvelope(entry, row) || entry.fingerprint !== persistedEventFingerprint(row)) {
      this.remove(key);
      return undefined;
    }
    this.touch(key, entry);
    return entry.revision;
  }
}
