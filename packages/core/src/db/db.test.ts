import { describe, it, expect } from 'vitest';
import { createDatabase } from './index.js';
import { projects, sessions, acpEvents } from './schema.js';
import { eq } from 'drizzle-orm';

describe('Database Core', () => {
  // Use in-memory database for tests to avoid side-effects
  const db = createDatabase(':memory:');

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
      taskSlug: 'test-task',
      baseCommit: 'abcdef123',
      agent: 'claude-code', // Valid agent from SessionStatus/Enum
      createdAt: new Date(),
    });

    const sessionResult = await db.select().from(sessions).where(eq(sessions.id, sessionId));
    expect(sessionResult).toHaveLength(1);
    expect(sessionResult[0].agent).toBe('claude-code');
    expect(sessionResult[0].taskSlug).toBe('test-task');
    expect(sessionResult[0].baseCommit).toBe('abcdef123');

    // Insert an event
    await db.insert(acpEvents).values({
      sessionId: sessionId,
      type: 'text', // Valid type from ACPEvent
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
      taskSlug: 'cascade-task',
      baseCommit: 'cascade123',
      agent: 'claude-code',
      createdAt: new Date(),
    });

    // Delete project
    await db.delete(projects).where(eq(projects.id, projectId));

    // Session should be gone
    const sessionResult = await db.select().from(sessions).where(eq(sessions.id, sessionId));
    expect(sessionResult).toHaveLength(0);
  });
});
