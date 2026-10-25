import { expect, it, vi } from 'vite-plus/test';
import type { SessionEventDbRow } from '@agentctl/core/db';
import { SessionEventCompactReader } from './session-event-compact-reader.js';
import {
  compactHistoryEvent,
  eventDetailRevision,
  SessionEventProjection,
} from './session-event-projection.js';
import { parseEventRow } from './session-event-row.js';
import { decodingRows } from '../../tests/performance/row-decoding-fixture.js';

function row(id = 1): SessionEventDbRow {
  return {
    id,
    sessionId: '11111111-1111-4111-8111-111111111111',
    parentEventId: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    type: 'tool_call',
    data: JSON.stringify({ name: 'read', kind: 'read', status: 'completed', rawOutput: 'body' }),
    metadata: null,
  };
}

it('preserves exact compact JSON and canonical revisions across all history variants', () => {
  const reader = new SessionEventCompactReader();
  for (const raw of [...decodingRows(36, true), row()]) {
    const expected = JSON.stringify(compactHistoryEvent(parseEventRow(raw)));
    expect(reader.encode(raw)).toBe(expected);
    expect(reader.encode({ ...raw })).toBe(expected);
  }
});

it('avoids full-output decoding and projection on a matching hit and reuses its detail revision', () => {
  const project = vi.fn(new SessionEventProjection().compact);
  const reader = new SessionEventCompactReader(project);
  const raw = row();
  const expectedRevision = eventDetailRevision(parseEventRow(raw));
  const decode = vi.spyOn(JSON, 'parse');
  try {
    const first = reader.encode(raw);
    const calls = decode.mock.calls.length;
    expect(calls).toBeGreaterThan(0);
    expect(reader.encode({ ...raw })).toBe(first);
    expect(reader.revision(raw)).toBe(expectedRevision);
    expect(decode.mock.calls).toHaveLength(calls);
    expect(project).toHaveBeenCalledTimes(1);
  } finally {
    decode.mockRestore();
  }
});

it('invalidates same-length output/metadata changes and envelope changes without leaking sessions', () => {
  const reader = new SessionEventCompactReader();
  const original = row();
  const first = reader.encode(original);
  for (const updated of [
    { ...original, data: original.data.replace('body', 'edit') },
    { ...original, metadata: '{"durationMs":5}' },
    { ...original, parentEventId: 99 },
    { ...original, createdAt: new Date('2026-01-02T00:00:00Z') },
    { ...original, sessionId: '22222222-2222-4222-8222-222222222222' },
  ]) {
    expect(reader.revision(updated)).toBeUndefined();
    expect(reader.encode(updated)).toBe(
      JSON.stringify(compactHistoryEvent(parseEventRow(updated))),
    );
    expect(reader.encode(original)).toBe(first);
  }
  const meta = { ...original, metadata: '{"durationMs":5}' };
  reader.encode(meta);
  const changed = { ...meta, metadata: '{"durationMs":6}' };
  expect(reader.revision(changed)).toBeUndefined();
  expect(reader.encode(changed)).not.toBe(reader.encode(meta));
});

it('fingerprints all UTF-16 values distinctly, including unescaped lone surrogates', () => {
  const reader = new SessionEventCompactReader();
  for (const body of ['\ud800', '\ud801', '\ufffd', '界', '😀']) {
    const raw = { ...row(), data: row().data.replace('body', body) };
    expect(reader.encode(raw)).toBe(JSON.stringify(compactHistoryEvent(parseEventRow(raw))));
    expect(reader.revision(raw)).toBe(eventDetailRevision(parseEventRow(raw)));
  }
});

it('rejects corrupt data and malformed envelopes even after a valid cached read', () => {
  const reader = new SessionEventCompactReader();
  const raw = row();
  for (const corrupt of [
    { ...raw, data: '{' },
    { ...raw, data: raw.data.replace('"name":"read"', '"name":null') },
    { ...raw, metadata: '{' },
    { ...raw, metadata: 'null' },
    { ...raw, createdAt: raw.createdAt.toISOString() } as unknown as SessionEventDbRow,
  ]) {
    reader.encode(raw);
    expect(() => reader.encode(corrupt)).toThrow();
  }
});

it('does not cache active, unknown or oversized output representations', () => {
  const project = vi.fn(new SessionEventProjection().compact);
  const reader = new SessionEventCompactReader(project);
  for (const data of [
    { name: 'read', status: 'in_progress', rawOutput: 'body' },
    { name: 'custom', kind: 'other', status: 'completed', rawOutput: 'body' },
    {
      name: 'read',
      status: 'completed',
      rawOutput: 'body',
      arguments: { input: 'x'.repeat(9000) },
    },
  ]) {
    const raw = { ...row(), data: JSON.stringify(data) };
    reader.encode(raw);
    reader.encode(raw);
    expect(reader.revision(raw)).toBeUndefined();
  }
  expect(project).toHaveBeenCalledTimes(6);
});

it('bounds entry count and refreshes recently used rows', () => {
  const project = vi.fn(new SessionEventProjection().compact);
  const reader = new SessionEventCompactReader(project);
  for (let id = 1; id <= 1024; id++) reader.encode(row(id));
  reader.encode(row(1));
  reader.encode(row(1025));
  expect(project).toHaveBeenCalledTimes(1025);
  reader.encode(row(1));
  expect(project).toHaveBeenCalledTimes(1025);
  reader.encode(row(2));
  expect(project).toHaveBeenCalledTimes(1026);
});

it('bounds total encoded characters and releases replaced entries from the budget', () => {
  const project = vi.fn(new SessionEventProjection().compact);
  const reader = new SessionEventCompactReader(project);
  const large = (id: number) => ({
    ...row(id),
    data: JSON.stringify({
      name: 'read',
      status: 'completed',
      rawOutput: 'body',
      arguments: { input: 'x'.repeat(3000) },
    }),
  });
  for (let id = 1; id <= 200; id++) reader.encode(large(id));
  expect(reader.revision(large(1))).toBeUndefined();
  expect(reader.revision(large(200))).toBeDefined();
  // Updating one row repeatedly must not consume a new budget slot each time.
  const replacement = new SessionEventCompactReader();
  for (let i = 0; i < 200; i++)
    replacement.encode({ ...large(1), metadata: JSON.stringify({ i }) });
  replacement.encode(row(2));
  expect(replacement.revision(row(2))).toBeDefined();
});

it('validates malformed JSON field boundaries even when their combined hash input matches', () => {
  const reader = new SessionEventCompactReader();
  const raw = { ...row(), metadata: '{}' };
  reader.encode(raw);
  const comma = raw.data.indexOf(',');
  const corrupt = {
    ...raw,
    data: raw.data.slice(0, comma),
    metadata: raw.data.slice(comma + 1) + ',{}',
  };
  expect(() => reader.encode(corrupt)).toThrow();
});
