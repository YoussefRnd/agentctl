import { expect, test } from 'vitest';
import type { SessionEventRow } from '@agentctl/shared';
import { latestPlanArtifacts } from './libPlanArtifacts';

test('a removal snapshot clears a persisted plan instead of restoring stale content', () => {
  const persisted = [{ id: 'a', kind: 'markdown' as const, markdown: 'Old plan' }];
  const events = [
    { type: 'plan_update', data: { plan: [], artifacts: [] } },
  ] as unknown as SessionEventRow[];
  expect(latestPlanArtifacts(events, persisted)).toEqual([]);
  expect(latestPlanArtifacts([], persisted)).toEqual(persisted);
});
