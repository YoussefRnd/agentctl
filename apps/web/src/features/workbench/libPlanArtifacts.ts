import type { PlanArtifact, SessionEventRow } from '@agentctl/shared';

export function latestPlanArtifacts(
  events: SessionEventRow[],
  persisted: PlanArtifact[] = [],
): PlanArtifact[] {
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    if (event.type === 'plan_update' && event.data.artifacts !== undefined)
      return event.data.artifacts;
  }
  return persisted;
}
