import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db } from './index.js';
import { projects, sessions, acpEvents } from './schema.js';
import { eq } from 'drizzle-orm';
import { rmSync, existsSync } from 'node:fs';

describe('Database Core', () => {
  const dbPath = 'agentctl.db';

  beforeAll(() => {
    if (existsSync(dbPath)) {
      rmSync(dbPath);
    }
  });

  it('should initialize the database and allow inserting/querying', async () => {
    const projectId = 'test-project';
    const sessionId = 'test-session';

    // Insert a project
    await db.insert(projects).values({
      id: projectId,
      name: 'Test Project',
      path: '/tmp/test-project',
      createdAt: new Date(),
    });

    const projectResult = await db.select().from(projects).where(eq(projects.id, projectId));
    expect(projectResult).toHaveLength(1);
    expect(projectResult[0].name).toBe('Test Project');

    // Insert a session
    await db.insert(sessions).values({
      id: sessionId,
      projectId: projectId,
      branch: 'main',
      worktreePath: '/tmp/worktree',
      agent: 'test-agent',
      createdAt: new Date(),
    });

    const sessionResult = await db.select().from(sessions).where(eq(sessions.id, sessionId));
    expect(sessionResult).toHaveLength(1);
    expect(sessionResult[0].agent).toBe('test-agent');

    // Insert an event
    await db.insert(acpEvents).values({
      sessionId: sessionId,
      type: 'test-event',
      data: JSON.stringify({ key: 'value' }),
      createdAt: new Date(),
    });

    const eventResult = await db.select().from(acpEvents).where(eq(acpEvents.sessionId, sessionId));
    expect(eventResult).toHaveLength(1);
    expect(JSON.parse(eventResult[0].data)).toEqual({ key: 'value' });
  });

  it('should respect cascading deletes', async () => {
    const projectId = 'cascade-project';
    const sessionId = 'cascade-session';

    await db.insert(projects).values({
      id: projectId,
      name: 'Cascade Project',
      path: '/tmp/cascade-project',
      createdAt: new Date(),
    });

    await db.insert(sessions).values({
      id: sessionId,
      projectId: projectId,
      branch: 'main',
      worktreePath: '/tmp/cascade-worktree',
      agent: 'test-agent',
      createdAt: new Date(),
    });

    // Delete project
    await db.delete(projects).where(eq(projects.id, projectId));

    // Session should be gone
    const sessionResult = await db.select().from(sessions).where(eq(sessions.id, sessionId));
    expect(sessionResult).toHaveLength(0);
  });
});
