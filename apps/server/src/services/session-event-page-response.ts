import type { SessionEventDbRow } from '@agentctl/core/db';
import type { CapturedEventPage } from './session-event-page-reader.js';
import { parseEventRow } from './session-event-row.js';
import { SessionEventCompactReader } from './session-event-compact-reader.js';

// Keep decoded bodies inside this call; only encoded output survives a scheduler yield.
function encodeRow(
  row: SessionEventDbRow,
  compact: boolean,
  encodeCompact: (row: SessionEventDbRow) => string,
) {
  const encoded = compact ? encodeCompact(row) : JSON.stringify(parseEventRow(row));
  return {
    encoded,
    workCharacters: compact
      ? Math.max(encoded.length, row.data.length + (row.metadata?.length ?? 0))
      : encoded.length,
  };
}

/** Consumes the captured rows; finish validation before headers so corrupt pages never leak payloads. */
export function* prepareEventPageResponse(
  capture: () => CapturedEventPage | undefined,
  compact = false,
  encodeCompact: (row: SessionEventDbRow) => string = new SessionEventCompactReader().encode,
) {
  const page = capture();
  if (!page) return undefined;
  const { rows, ...cursors } = page;
  const events: string[] = [];
  try {
    yield;
    // Pop in wire order without copying or retaining rows that are already encoded.
    rows.reverse();
    let batchRows = 0;
    let batchCharacters = 0;
    while (rows.length > 0) {
      const { encoded, workCharacters } = encodeRow(rows.pop()!, compact, encodeCompact);
      events.push(encoded);
      batchRows++;
      batchCharacters += workCharacters;
      // Amortize request-context/scheduler overhead without making large payload batches.
      // UTF-8 takes at most three bytes per UTF-16 code unit; one large event stays indivisible.
      if (batchRows >= 8 || batchCharacters >= 8_192) {
        batchRows = 0;
        batchCharacters = 0;
        yield;
      }
    }
    if (batchRows > 0) yield;
    // Only the envelope is assembled here; individual event payloads are already JSON encoded.
    return `{"events":[${events.join(',')}],${JSON.stringify(cursors).slice(1)}`;
  } finally {
    rows.length = 0;
    events.length = 0;
  }
}
