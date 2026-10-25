import { createHash } from 'node:crypto';
import { expect, it } from 'vite-plus/test';
import { decodingRows } from '../../tests/performance/row-decoding-fixture.js';
import { parseEventRow } from './session-event-row.js';
import {
  eventDetailRevision,
  eventDetailRevisionForRow,
  persistedEventFingerprint,
} from './session-event-revision.js';

it('preserves the existing revision bytes, including Unicode and optional metadata', () => {
  for (const raw of decodingRows(36, true)) {
    const event = parseEventRow(raw);
    const expected = createHash('sha256')
      .update(
        JSON.stringify([
          event.sessionId,
          event.id,
          event.type,
          event.createdAt,
          event.data,
          event.metadata,
        ]),
      )
      .digest('hex');
    expect(eventDetailRevision(event)).toBe(expected);
    expect(eventDetailRevisionForRow(raw, event).revision).toBe(expected);
    const canonical = {
      ...raw,
      data: JSON.stringify(event.data),
      metadata: event.metadata ? JSON.stringify(event.metadata) : null,
    };
    expect(persistedEventFingerprint(canonical)).toBe(expected);
    expect(eventDetailRevisionForRow(canonical, event, expected)).toEqual({
      revision: expected,
      fingerprint: expected,
    });
    const spaced = { ...canonical, data: ' ' + canonical.data + ' ' };
    expect(persistedEventFingerprint(spaced)).not.toBe(expected);
    expect(eventDetailRevisionForRow(spaced, event).revision).toBe(expected);
  }
});
