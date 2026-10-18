import { expect, test } from 'vite-plus/test';
import { createDatabase, projects, sessions } from '../db/index.js';
import { SessionStateProjector } from './projection/session-state-projector.js';
import { SessionEventRepository } from './persistence/session-event-repository.js';
import { sessionEventCodecs } from '../db/json-codecs.js';
import { eq } from 'drizzle-orm';

test('plan updates persist multiple formats and removal survives projector restart', async () => {
  const db = createDatabase(':memory:');
  db.insert(projects).values({ id: 'p', name: 'P', path: '/tmp' }).run();
  db.insert(sessions)
    .values({
      id: 's',
      projectId: 'p',
      worktreePath: '/tmp',
      taskSlug: 'task',
      branch: 'main',
      baseCommit: 'base',
      agent: 'agent',
      selectedProvider: 'agent',
    })
    .run();
  const store = new SessionEventRepository(db, { publish() {} });
  let projector = new SessionStateProjector('s', db, store);
  await projector.handleDomainEvent({
    type: 'plan_update',
    plan: [],
    artifact: { id: 'a', kind: 'markdown', markdown: '# Plan' },
  });
  await projector.handleDomainEvent({
    type: 'plan_update',
    plan: [],
    artifact: { id: 'b', kind: 'file', uri: 'file:///tmp/plan.md' },
  });
  projector = new SessionStateProjector('s', db, store);
  await projector.handleDomainEvent({ type: 'plan_update', plan: [], removedPlanId: 'a' });
  const session = db.select().from(sessions).where(eq(sessions.id, 's')).get()!;
  expect(JSON.parse(session.planArtifacts)).toEqual([
    { id: 'b', kind: 'file', uri: 'file:///tmp/plan.md' },
  ]);
  expect(JSON.parse(session.plan)).toEqual([]);
  expect(
    sessionEventCodecs.planUpdate({ plan: [], artifacts: JSON.parse(session.planArtifacts) })
      .artifacts,
  ).toHaveLength(1);
});
