import { expect, test } from 'vite-plus/test';
import { createDatabase, projects, sessions } from '../../db/index.js';
import { SessionEventRepository } from '../persistence/session-event-repository.js';
import { SessionStateProjector } from './session-state-projector.js';

test('persists live reasoning selections and clears the override when the option is removed', async () => {
  const db = createDatabase(':memory:');
  db.insert(projects).values({ id: 'p', name: 'Project', path: '/tmp' }).run();
  db.insert(sessions)
    .values({
      id: 's',
      projectId: 'p',
      worktreePath: '/tmp',
      branch: 'main',
      baseCommit: 'none',
      agent: 'provider',
      selectedProvider: 'provider',
      taskSlug: 'reasoning',
    })
    .run();
  const repository = new SessionEventRepository(db, { publish() {} });
  const projector = new SessionStateProjector('s', db, repository);
  await projector.handleDomainEvent({
    type: 'config_option_update',
    configOptions: [
      {
        id: 'opaque-budget',
        category: 'thought_level',
        name: 'Reasoning',
        type: 'select',
        currentValue: 'thinking',
        options: [
          { value: 'none', name: 'None' },
          { value: 'thinking', name: 'Thinking' },
        ],
      },
    ],
  });
  expect(db.select().from(sessions).get()?.selectedThinkingEffort).toBe('thinking');
  await projector.handleDomainEvent({ type: 'config_option_update', configOptions: [] });
  const row = db.select().from(sessions).get()!;
  expect(row.selectedThinkingEffort).toBeNull();
  expect(JSON.parse(row.sessionConfigOptions)).toEqual([]);
});
