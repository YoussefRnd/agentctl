import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decodingScenarios, evaluateDecoding } from './decoding-budget.mjs';

function samples(ratios) {
  return ratios.map((ratio) => ({
    schemaVersion: 1,
    passed: true,
    scenarios: decodingScenarios.map((scenario) => ({
      ...scenario,
      medianNs: { fullReference: 100, fullCandidate: 100 * ratio },
    })),
  }));
}

test('relative budget uses the median across fresh processes, tolerating one noisy run', () => {
  assert(evaluateDecoding(samples([0.7, 1.1, 3])).every((row) => row.passed && row.ratio === 1.1));
  assert(evaluateDecoding(samples([1.3, 1.4, 0.5])).every((row) => !row.passed));
  assert(evaluateDecoding(samples([1.25, 1.25, 1.25])).every((row) => row.passed));
});

test('incomplete, malformed and non-finite samples fail closed', () => {
  assert.throws(() => evaluateDecoding(samples([1, 1])));
  for (const ratio of [NaN, Infinity, 0, -1])
    assert.throws(() => evaluateDecoding(samples([ratio, ratio, ratio])));
  for (const change of [
    (sample) => {
      sample.passed = false;
    },
    (sample) => {
      sample.schemaVersion = 2;
    },
    (sample) => {
      sample.scenarios.pop();
    },
    (sample) => {
      sample.scenarios[1] = sample.scenarios[0];
    },
  ]) {
    const values = samples([1, 1, 1]);
    change(values[0]);
    assert.throws(() => evaluateDecoding(values));
  }
});
