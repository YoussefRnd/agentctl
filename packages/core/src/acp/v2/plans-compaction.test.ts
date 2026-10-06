import { expect, test } from 'vitest';
import { createV2SessionProjector } from './events.js';

test('preserves Markdown, file plans, identities, and removal notices', () => {
  const project = createV2SessionProjector();
  expect(
    project({
      sessionUpdate: 'plan_update',
      plan: { type: 'markdown', planId: 'a', content: '# Steps' },
    }),
  ).toMatchObject([{ artifact: { id: 'a', kind: 'markdown', markdown: '# Steps' } }]);
  expect(
    project({
      sessionUpdate: 'plan_update',
      plan: { type: 'file', planId: 'b', uri: 'file:///tmp/plan.md' },
    }),
  ).toMatchObject([{ artifact: { id: 'b', kind: 'file', uri: 'file:///tmp/plan.md' } }]);
  expect(project({ sessionUpdate: 'plan_removed', planId: 'a' })).toEqual([
    { type: 'plan_update', plan: [], removedPlanId: 'a' },
  ]);
});

test('compaction accumulates chunks, replaces final summary, and reports errors', () => {
  const project = createV2SessionProjector();
  project({ sessionUpdate: 'compaction_update', compactionId: 'compact', status: 'in_progress' });
  project({
    sessionUpdate: 'compaction_summary_chunk',
    compactionId: 'compact',
    content: { type: 'text', text: 'First ' },
  });
  expect(
    project({
      sessionUpdate: 'compaction_summary_chunk',
      compactionId: 'compact',
      content: { type: 'text', text: 'second' },
    }),
  ).toMatchObject([
    {
      call: {
        toolCallId: 'acp-compaction:compact',
        status: 'in_progress',
        rawOutput: { summary: 'First second' },
      },
    },
  ]);
  expect(
    project({
      sessionUpdate: 'compaction_update',
      compactionId: 'compact',
      status: 'completed',
      summary: [{ type: 'text', text: 'Final' }],
    }),
  ).toMatchObject([{ call: { status: 'completed', rawOutput: { summary: 'Final' } } }]);
  expect(
    project({
      sessionUpdate: 'compaction_update',
      compactionId: 'failed',
      status: 'failed',
      error: 'Out of capacity',
    }),
  ).toMatchObject([{ call: { status: 'failed', rawOutput: { error: 'Out of capacity' } } }]);
});
