import { randomUUID } from 'node:crypto';
import { expect, test } from 'vitest';
import { createDatabase, projects, sessions } from '@agentctl/core/db';
import { SessionService } from './session-service.js';

test('loads a saved session with a provider-specific reasoning value', async () => {
  const db = createDatabase(':memory:');
  const projectId = randomUUID();
  const sessionId = randomUUID();
  db.insert(projects).values({ id: projectId, name: 'Project', path: '/tmp' }).run();
  db.insert(sessions)
    .values({
      id: sessionId,
      projectId,
      worktreePath: '/tmp',
      branch: 'main',
      baseCommit: 'none',
      agent: 'opencode',
      selectedProvider: 'opencode',
      taskSlug: 'reasoning',
      selectedThinkingEffort: 'none',
      totalTokens: 1,
    })
    .run();
  const service = new SessionService(
    db,
    {} as never,
    {} as never,
    { discover: async () => [] } as never,
    {} as never,
  );
  const result = await service.getSessionWithCapabilities(sessionId);
  expect(result.session.selectedThinkingEffort).toBe('none');
});
