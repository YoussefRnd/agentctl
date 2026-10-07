import assert from 'node:assert/strict';
import { test } from 'node:test';
import { budgets, checkReport } from './performance-budgets.mjs';
import { journeyIds } from './performance-journeys.mjs';

function streamReport() {
  return {
    schemaVersion: 1,
    fixtureVersion: 1,
    environment: { mode: 'performance' },
    scenarios: [1, 2, 3].map((repetition) => ({
      scenario: 'session-stream',
      repetition,
      updateCount: 16,
      subscribers: { queue: 0, turn: 0, prompts: 1 },
      commits: { conversation: { count: 40, totalMs: 50 } },
      phases: [{ name: 'stream-updates', commits: { conversation: { count: 40, totalMs: 50 } } }],
      elapsedMs: 1500,
    })),
  };
}

function journeyReport(bytes = budgets.baseline.startupJavaScriptBytes) {
  return {
    schemaVersion: 1,
    fixtureVersion: 1,
    environment: { apiDelayMs: 120 },
    scenarios: [1, 2, 3].map((repetition) => ({
      repetition,
      startup: {
        resources: [{ name: '/assets/index-fixture.js', bytes }],
        moduleBytes: bytes,
        eagerDeferredAssets: [],
        samples: [{ name: 'launch-to-typeable', durationMs: 900 }],
      },
      navigation: ['click', 'hover', 'focus', 'revisit'].map((intent) => {
        const id = journeyIds[intent === 'hover' ? 2 : 3];
        const paths = [`/api/sessions/${id}`, `/api/sessions/${id}/events/page`];
        return {
          intent,
          durationMs: 400,
          requestsBeforeClick: paths,
          requests: paths.map((path) => ({ path })),
        };
      }),
    })),
  };
}

test('retains current count/byte baselines and rejects the prior eager startup', () => {
  checkReport('stream', streamReport());
  checkReport('journeys', journeyReport());
  checkReport('journeys', journeyReport(budgets.startupJavaScriptBytes));
  assert.throws(
    () => checkReport('journeys', journeyReport(budgets.startupJavaScriptBytes + 1)),
    /exceeds/,
  );
  assert.throws(
    () => checkReport('journeys', journeyReport(budgets.baseline.beforeStartupJavaScriptBytes)),
    /exceeds/,
  );
});

test('rejects restored per-delta subscribers and invalid commit counts', () => {
  for (const [subscriber, value] of [
    ['queue', 19],
    ['turn', 19],
    ['prompts', 19],
    ['queue', NaN],
    ['turn', -1],
    ['prompts', 0.5],
  ]) {
    const report = streamReport();
    report.scenarios[1].subscribers[subscriber] = value;
    assert.throws(() => checkReport('stream', report), /commits|committed/);
  }
});

test('rejects partial, duplicate, unprofiled, or changed stream workloads', () => {
  for (const mutate of [
    (r) => r.scenarios.pop(),
    (r) => {
      r.scenarios[1].repetition = 1;
    },
    (r) => {
      r.scenarios[0].updateCount = 1;
    },
    (r) => {
      r.fixtureVersion = 2;
    },
    (r) => {
      r.environment.mode = 'production';
    },
    (r) => {
      delete r.scenarios[0].subscribers;
    },
  ]) {
    const report = streamReport();
    mutate(report);
    assert.throws(() => checkReport('stream', report));
  }
});

test('rejects invalid profiling data rather than publishing an invalid trend', () => {
  for (const mutate of [
    (s) => {
      s.commits.conversation.count = Infinity;
    },
    (s) => {
      s.phases[0].commits.conversation.totalMs = NaN;
    },
    (s) => {
      delete s.phases;
    },
  ]) {
    const report = streamReport();
    mutate(report.scenarios[0]);
    assert.throws(() => checkReport('stream', report), /finite|missing update/);
  }
});

test('rejects eager overlays even if the derived deferred list is empty', () => {
  const report = journeyReport();
  report.scenarios[0].startup.resources[0].name = '/assets/SettingsDialog-fixture.js';
  assert.throws(() => checkReport('journeys', report), /Deferred asset/);
});

test('rejects missing resource sizes or inconsistent totals', () => {
  for (const mutate of [
    (r) => {
      r.scenarios[0].startup.resources[0].bytes = 0;
    },
    (r) => {
      r.scenarios[0].startup.moduleBytes = 1;
    },
    (r) => {
      r.scenarios[0].startup.resources = [];
    },
    (r) => {
      r.scenarios[0].startup.samples = [];
    },
    (r) => {
      r.scenarios[0].navigation.pop();
    },
  ]) {
    const report = journeyReport();
    mutate(report);
    assert.throws(() => checkReport('journeys', report));
  }
});

test('rejects prefetch that is missing or repeated after clicking for either intent', () => {
  for (const index of [1, 2]) {
    for (const type of ['missing', 'duplicate']) {
      const report = journeyReport();
      const navigation = report.scenarios[1].navigation[index];
      if (type === 'missing') navigation.requestsBeforeClick.pop();
      else navigation.requests.push({ ...navigation.requests[0] });
      assert.throws(() => checkReport('journeys', report), /prefetch|repeated request/);
    }
  }
});

test('keeps slow timing as a trend but rejects invalid measurements', () => {
  const report = journeyReport();
  report.scenarios[0].startup.samples[0].durationMs = 60_000;
  report.scenarios[0].navigation.forEach((n) => {
    n.durationMs = 60_000;
  });
  checkReport('journeys', report);
  report.scenarios[0].navigation[0].durationMs = NaN;
  assert.throws(() => checkReport('journeys', report), /finite/);
});

test('requires every component fixture and the actual worker result', () => {
  const report = streamReport();
  report.scenarios = [
    ['short-reply', 2085, 40],
    ['long-reply', 32804, 40],
    ['long-code-and-tables', 32882, 40],
    ['recent-conversation', 200, 12],
    ['large-conversation', 1000, 12],
    ['dense-tool-activity', 1000, 12],
  ].flatMap(([scenario, inputSize, updateCount]) =>
    [1, 2, 3].map((repetition) => ({
      scenario,
      inputSize,
      updateCount,
      repetition,
      finalMarkdownSource: 'worker',
      commits: { conversation: { count: 1, totalMs: 10 } },
      phases: [{ name: 'stream-updates', commits: { conversation: { count: 1, totalMs: 10 } } }],
      elapsedMs: 3000,
    })),
  );
  checkReport('components', report);
  report.scenarios[6].finalMarkdownSource = 'synchronous';
  assert.throws(() => checkReport('components', report), /main thread/);
  report.scenarios[6].finalMarkdownSource = 'worker';
  report.scenarios[12].inputSize = 200;
  assert.throws(() => checkReport('components', report), /fixture size/);
});
