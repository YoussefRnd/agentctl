import type { CapturedEventPage } from './session-event-page-reader.js';
import { parseEventRow } from './session-event-row.js';

/** Finish validation/serialization before sending headers, so corrupt rows never leak a partial page. */
export function* prepareEventPageResponse(capture: () => CapturedEventPage | undefined) {
  const page = capture();
  if (!page) return undefined;
  yield;
  const events: string[] = [];
  let batchRows = 0;
  let batchCharacters = 0;
  for (const row of page.rows) {
    const encoded = JSON.stringify(parseEventRow(row));
    events.push(encoded);
    batchRows++;
    batchCharacters += encoded.length;
    // Amortize request-context/scheduler overhead without making large payload batches.
    // UTF-8 takes at most three bytes per UTF-16 code unit; one large event stays indivisible.
    if (batchRows >= 8 || batchCharacters >= 8_192) {
      batchRows = 0;
      batchCharacters = 0;
      yield;
    }
  }
  if (batchRows > 0) yield;
  const { rows: _rows, ...cursors } = page;
  // Only the envelope is assembled here; individual event payloads are already JSON encoded.
  return `{"events":[${events.join(',')}],${JSON.stringify(cursors).slice(1)}`;
}
