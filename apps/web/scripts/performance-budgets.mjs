import assert from 'node:assert/strict';
import budgets from './performance-budgets.json' with { type: 'json' };
import { journeyIds } from './performance-journeys.mjs';

export { budgets };

function finite(value, label) {
  assert(Number.isFinite(value) && value >= 0, `${label} must be a finite nonnegative number`);
}

function count(value, label) {
  finite(value, label);
  assert(Number.isInteger(value), `${label} must be an integer`);
}

const fixtures = [
  ['short-reply', 2085, 40],
  ['long-reply', 32804, 40],
  ['long-code-and-tables', 32882, 40],
  ['recent-conversation', 200, 12],
  ['large-conversation', 1000, 12],
  ['dense-tool-activity', 1000, 12],
];

export function checkReport(kind, report) {
  assert.equal(report.schemaVersion, budgets.schemaVersion, 'Unknown report schema');
  assert(Array.isArray(report.scenarios), 'Missing scenario samples');
  if (kind === 'components' || kind === 'stream') {
    assert.equal(
      report.fixtureVersion,
      budgets.fixtureVersion,
      'Fixture changed; rebaseline first',
    );
    assert.equal(report.environment.mode, 'performance', 'Requires the profiling build');
    const expected = kind === 'stream' ? [['session-stream', undefined, 16]] : fixtures;
    assert.equal(
      report.scenarios.length,
      expected.length * budgets.repetitions,
      'Incomplete suite',
    );
    for (const [name, size, updates] of expected) {
      for (let repetition = 1; repetition <= budgets.repetitions; repetition++) {
        const samples = report.scenarios.filter(
          (s) => s.scenario === name && s.repetition === repetition,
        );
        assert.equal(samples.length, 1, `${name}: missing or duplicate repetition ${repetition}`);
        const sample = samples[0];
        assert.equal(sample.updateCount, updates, `${name}: workload changed`);
        if (size !== undefined)
          assert.equal(sample.inputSize, size, `${name}: fixture size changed`);
        count(sample.commits?.conversation?.count, `${name} profiling commits`);
        assert(sample.commits.conversation.count > 0, `${name}: missing profiling commits`);
        finite(sample.commits.conversation.totalMs, `${name} React time`);
        finite(sample.elapsedMs, `${name} elapsed time`);
        const update = sample.phases?.find((p) => p.name === 'stream-updates');
        assert(update, `${name}: missing update phase`);
        count(update.commits?.conversation?.count, `${name} update commits`);
        finite(update.commits.conversation.totalMs, `${name} update React time`);
        if (kind === 'stream') {
          for (const [subscriber, limit] of Object.entries(budgets.streamSubscriberCommits)) {
            const value = sample.subscribers?.[subscriber];
            count(value, `${subscriber} commits`);
            assert(value <= limit, `${subscriber} committed ${value} times; budget is ${limit}`);
          }
        } else if (name === 'long-code-and-tables') {
          assert.equal(
            sample.finalMarkdownSource,
            'worker',
            'Code fixture fell back to main thread',
          );
        }
      }
    }
  } else if (kind === 'journeys') {
    assert.equal(
      report.fixtureVersion,
      budgets.fixtureVersion,
      'Journey fixture changed; rebaseline first',
    );
    assert.equal(report.environment.apiDelayMs, 120, 'Journey API delay changed');
    assert.equal(report.scenarios.length, budgets.repetitions, 'Incomplete journey suite');
    for (const [index, sample] of report.scenarios.entries()) {
      assert.equal(sample.repetition, index + 1, 'Missing or duplicate journey repetition');
      const startup = sample.startup;
      assert(Array.isArray(startup.resources) && startup.resources.length > 0, 'Missing resources');
      startup.resources.forEach((resource) => count(resource.bytes, 'Resource bytes'));
      const modules = startup.resources.filter((r) => r.name.endsWith('.js'));
      const bytes = modules.reduce((sum, resource) => sum + resource.bytes, 0);
      assert(modules.length > 0 && modules.every((r) => r.bytes > 0), 'Missing JS resource sizes');
      assert.equal(startup.moduleBytes, bytes, 'Startup byte total differs from resource entries');
      assert(
        bytes <= budgets.startupJavaScriptBytes,
        `Startup JS ${bytes} exceeds ${budgets.startupJavaScriptBytes} bytes`,
      );
      assert.deepEqual(startup.eagerDeferredAssets, [], 'Closed overlay assets loaded at startup');
      assert(
        !startup.resources.some((r) =>
          /settings-ui|SettingsDialog|SetupWizard|ProviderAuthDialog|vendor-terminal/.test(r.name),
        ),
        'Deferred asset found in startup resources',
      );
      const launch = startup.samples.filter((s) => s.name === 'launch-to-typeable');
      assert.equal(launch.length, 1, 'Missing or duplicate launch measurement');
      finite(launch[0].durationMs, 'Launch duration');
      assert.equal(sample.navigation.length, 4, 'Incomplete navigation journeys');
      for (const [index, intent] of ['click', 'hover', 'focus', 'revisit'].entries()) {
        const navigation = sample.navigation[index];
        assert.equal(navigation.intent, intent, 'Navigation workload changed');
        finite(navigation.durationMs, `${intent} duration`);
        if (intent !== 'hover' && intent !== 'focus') continue;
        const id = journeyIds[intent === 'hover' ? 2 : 3];
        for (const path of [`/api/sessions/${id}`, `/api/sessions/${id}/events/page`]) {
          assert.equal(
            navigation.requestsBeforeClick.filter((p) => p === path).length,
            1,
            `${intent}: missing or duplicate prefetch ${path}`,
          );
          assert.equal(
            navigation.requests.filter((r) => r.path === path).length,
            1,
            `${intent}: repeated request ${path}`,
          );
        }
      }
    }
  } else {
    throw new Error(`Unknown performance suite: ${kind}`);
  }
}

export function trendRows(kind, report) {
  const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
  if (kind === 'journeys') {
    return [
      [
        'Launch to typeable',
        median(
          report.scenarios.map(
            (s) => s.startup.samples.find((m) => m.name === 'launch-to-typeable').durationMs,
          ),
        ),
      ],
      ...['click', 'hover', 'focus', 'revisit'].map((intent) => [
        `Navigation: ${intent}`,
        median(
          report.scenarios.map((s) => s.navigation.find((n) => n.intent === intent).durationMs),
        ),
      ]),
    ];
  }
  return [...new Set(report.scenarios.map((s) => s.scenario))].map((scenario) => [
    `${scenario}: update React time`,
    median(
      report.scenarios
        .filter((s) => s.scenario === scenario)
        .map((s) => s.phases.find((p) => p.name === 'stream-updates').commits.conversation.totalMs),
    ),
  ]);
}
