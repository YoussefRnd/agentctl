import { describe, expect, expectTypeOf, it } from 'vite-plus/test';
import { z } from 'zod';
import { sessionEventRowSchema, type SessionEventRow } from '@agentctl/shared';
import { parseEventRow } from './session-event-row.js';
import {
  decodingRows,
  decodeLegacyRow,
  eventExamples,
  legacyEventRowSchema,
} from '../../tests/performance/row-decoding-fixture.js';

type LegacyRow = z.infer<typeof legacyEventRowSchema>;

describe('session event row decoding', () => {
  it('preserves the discriminated union for consumers', () => {
    expectTypeOf<(typeof eventExamples)[number]['type']>().toEqualTypeOf<SessionEventRow['type']>();
    expectTypeOf<SessionEventRow>().toMatchTypeOf<LegacyRow>();
    expectTypeOf<LegacyRow>().toMatchTypeOf<SessionEventRow>();
    expectTypeOf<
      Extract<SessionEventRow, { type: 'text' }>['data']['content']
    >().toEqualTypeOf<string>();
    expectTypeOf<
      Extract<SessionEventRow, { type: 'terminal_exit' }>['data']['code']
    >().toEqualTypeOf<number | null>();
  });

  it('matches the reference for every persisted event variant and metadata', () => {
    for (const row of decodingRows(36, true))
      expect(parseEventRow(row)).toEqual(decodeLegacyRow(row));
    const parsed = parseEventRow(decodingRows(1, false)[0]);
    expect(parsed.type).toBe('text');
    if (parsed.type === 'text') expect(parsed.data.content).toBe('Synthetic history '.repeat(16));
    expect(parsed.metadata?.futureField).toEqual({ retained: true });
  });

  it('keeps database and JSON validation before wire validation', () => {
    const row = decodingRows(1, false)[0];
    for (const change of [
      { id: '1' },
      { createdAt: '2026-01-01' },
      { data: {} },
      { data: '{' },
      { metadata: '{' },
      { metadata: 'null' },
      { metadata: '{"durationMs":"bad"}' },
      { sessionId: 'invalid' },
      { data: '{"role":"invalid"}' },
      { type: 'future' },
    ]) {
      expect(() => Reflect.apply(parseEventRow, undefined, [{ ...row, ...change }])).toThrow();
    }
  });

  it('preserves wire acceptance, defaults, transforms and unknown-field handling', () => {
    const changes = [
      {},
      { id: '1' },
      { id: NaN },
      { sessionId: 'invalid' },
      { sequence: -1 },
      { sequence: 0 },
      { sequence: 0.5 },
      { parentEventId: null },
      { parentEventId: '1' },
      { metadata: null },
      { metadata: { future: [1, 2], cost: 1 } },
      { metadata: { cost: '1' } },
      { delta: 'chunk', sequence: 2 },
      { delta: 1 },
      { createdAt: '2026-01-01T00:00:00Z' },
      { createdAt: 'invalid' },
      { type: 'future' },
      { data: null },
      { data: undefined },
      { data: {} },
      { data: [] },
      { data: { content: '', text: 'legacy', extra: true } },
      { data: { content: 'current', text: 'legacy' } },
      {
        data: {
          content: [{ type: 'content', content: { text: 'tool', future: true }, extra: true }],
          future: true,
        },
      },
      { data: { terminalId: 't', code: null, future: true } },
    ];
    for (const event of eventExamples)
      for (const change of changes) {
        const input = {
          ...event,
          id: 1,
          sessionId: '00000000-0000-4000-8000-000000000001',
          createdAt: new Date('2026-01-01T00:00:00Z'),
          extra: true,
          ...change,
        };
        const reference = legacyEventRowSchema.safeParse(input);
        const candidate = sessionEventRowSchema.safeParse(input);
        expect(candidate.success, `${event.type}: ${JSON.stringify(change)}`).toBe(
          reference.success,
        );
        if (candidate.success && reference.success) expect(candidate.data).toEqual(reference.data);
      }
  });
});
