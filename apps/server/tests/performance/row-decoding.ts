import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { sessionEventDbRowSchema } from '@agentctl/core/db';
import { sessionEventRowSchema } from '@agentctl/shared';
import { parseEventRow } from '../../src/services/session-event-row.js';
import { decodingRows, decodeLegacyRow } from './row-decoding-fixture.js';

const [output] = process.argv.slice(2);
assert(output);
const scenarios = [];
// Retain only a rotating ring: results escape the loop without retaining every allocation.
const sink: unknown[] = Array.from({ length: 64 });
for (const [count, mixed] of [
  [200, false],
  [200, true],
  [500, true],
] as const) {
  const rows = decodingRows(count, mixed);
  for (const row of rows) assert.deepEqual(parseEventRow(row), decodeLegacyRow(row));
  const validated = rows.map((row) => sessionEventDbRowSchema.parse(row));
  const data = validated.map((row) => JSON.parse(row.data) as unknown);
  const metadata = validated.map((row) =>
    row.metadata === null ? undefined : (JSON.parse(row.metadata) as unknown),
  );
  const decoded = validated.map((row, i) => ({ ...row, data: data[i], metadata: metadata[i] }));
  const stages = {
    databaseValidation: (i: number) => sessionEventDbRowSchema.parse(rows[i]),
    dataJson: (i: number) => JSON.parse(validated[i].data) as unknown,
    metadataJson: (i: number) =>
      validated[i].metadata === null ? undefined : (JSON.parse(validated[i].metadata!) as unknown),
    construction: (i: number) => ({ ...validated[i], data: data[i], metadata: metadata[i] }),
    wireValidation: (i: number) => sessionEventRowSchema.parse(decoded[i]),
    fullReference: (i: number) => decodeLegacyRow(rows[i]),
    fullCandidate: (i: number) => parseEventRow(rows[i]),
  };
  const repetitions: Record<string, number[]> = Object.fromEntries(
    Object.keys(stages).map((key) => [key, []]),
  );
  const iterations = 20_000;
  const measure = (stage: (i: number) => unknown) => {
    const start = performance.now();
    for (let i = 0; i < iterations; i++) sink[i % sink.length] = stage(i % rows.length);
    return ((performance.now() - start) * 1e6) / iterations;
  };
  // Discard two passes, then alternate stage order to reduce systematic JIT/GC ordering bias.
  for (let repetition = -2; repetition < 7; repetition++) {
    const entries = Object.entries(stages);
    if (repetition % 2 === 0) entries.reverse();
    for (const [key, stage] of entries) {
      const ns = measure(stage);
      if (repetition >= 0) repetitions[key].push(ns);
    }
  }
  const median = (values: number[]) =>
    [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
  const medianNs = Object.fromEntries(
    Object.entries(repetitions).map(([key, values]) => [key, median(values)]),
  );
  scenarios.push({
    count,
    mixed,
    iterations,
    repetitions,
    medianNs,
    candidateToReference: medianNs.fullCandidate / medianNs.fullReference,
  });
}
assert(sink.some(Boolean));
await writeFile(output, JSON.stringify({ schemaVersion: 1, passed: true, scenarios }, null, 2));
