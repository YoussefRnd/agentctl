import { test, expect, describe } from 'vitest';
import { createDatabase } from '../db/index.js';
import { projects, sessions, acpEvents } from '../db/schema.js';
import { ACPSession } from './acp-session.js';
import { SessionEventStore } from './session-event-store.js';
import { eq } from 'drizzle-orm';
import type { AgentRuntimeHandle } from './acp-transport.js';

describe('ACPSession Observability & StreamBuffer Integration', () => {
  test('buffers database updates while publishing instantly to eventBus, links parents, and tracks metrics', async () => {
    const db = createDatabase(':memory:');

    // Set up project and session
    await db.insert(projects).values({
      id: 'proj-obs',
      name: 'Observability Test Project',
      path: '/tmp/proj-obs',
    });

    await db.insert(sessions).values({
      id: 'sess-obs',
      projectId: 'proj-obs',
      branch: 'main',
      worktreePath: '/tmp/proj-obs',
      taskSlug: 'test-obs',
      agent: 'claude-acp',
      baseCommit: 'hash',
    });

    const publishedEvents: { id: number; sessionId: string; type: string; data: string; createdAt: Date }[] = [];
    const eventBus = {
      publish: (evt: { id: number; sessionId: string; type: string; data: string; createdAt: Date }) => {
        publishedEvents.push(evt);
      },
      subscribe: () => () => { /* noop */ },
    };

    const eventStore = new SessionEventStore(db, eventBus);

    // Mock runtime handle
    let promptCallback: (() => Promise<void>) | null = null;
    const fakeRuntimeHandle = {
      acpSessionId: 'acp-obs-123',
      closed: new Promise<void>(() => { /* noop */ }),
      onProcessError: () => { /* noop */ },
      onProcessExit: () => { /* noop */ },
      prompt: async () => {
        if (promptCallback) {
          await promptCallback();
        }
      },
      respondToPermission: () => { /* noop */ },
      stop: async () => { /* noop */ },
      updateModel: async () => { /* noop */ },
      updateConfigOption: async () => { /* noop */ },
    } as unknown as AgentRuntimeHandle;

    const session = new ACPSession(
      'sess-obs',
      fakeRuntimeHandle,
      db,
      eventStore,
      '/tmp/proj-obs',
    );

    // Set up what happens during runtime handle prompt
    promptCallback = async () => {
      // 1. Send thought chunks
      await session.handleDomainEvent({ type: 'thought', text: 'Thinking' });
      await session.handleDomainEvent({ type: 'thought', text: ' about' });
      await session.handleDomainEvent({ type: 'thought', text: ' logic' });

      // 2. Send text chunks
      await session.handleDomainEvent({ type: 'text', text: 'Hello' });
      await session.handleDomainEvent({ type: 'text', text: ' world' });
    };

    // Execute prompt
    await session.prompt('Test prompt');

    // Retrieve events from DB to assert their state
    const dbEvents = await db.select().from(acpEvents).where(eq(acpEvents.sessionId, 'sess-obs'));

    // We expect 3 distinct events recorded in DB:
    // 1. User prompt (type: 'text', role: 'user')
    // 2. Thought event (type: 'text', role: 'thought')
    // 3. Response event (type: 'text', role: 'provider')
    expect(dbEvents.length).toBe(3);

    const userEvent = dbEvents.find(e => {
      const parsed = JSON.parse(e.data) as Record<string, unknown>;
      return parsed.role === 'user';
    });
    const thoughtEvent = dbEvents.find(e => {
      const parsed = JSON.parse(e.data) as Record<string, unknown>;
      return parsed.role === 'thought';
    });
    const providerEvent = dbEvents.find(e => {
      const parsed = JSON.parse(e.data) as Record<string, unknown>;
      return parsed.role === 'provider';
    });

    expect(userEvent).toBeDefined();
    expect(thoughtEvent).toBeDefined();
    expect(providerEvent).toBeDefined();

    if (!userEvent || !thoughtEvent || !providerEvent) {
      throw new Error('Required events not found');
    }

    // Verify parentEventId linkage
    expect(userEvent.parentEventId).toBeNull();
    expect(thoughtEvent.parentEventId).toBe(userEvent.id);
    expect(providerEvent.parentEventId).toBe(userEvent.id);

    // Verify buffered content in DB (flushed at end of turn)
    expect((JSON.parse(thoughtEvent.data) as Record<string, unknown>).content).toBe('Thinking about logic');
    expect((JSON.parse(providerEvent.data) as Record<string, unknown>).content).toBe('Hello world');

    // Verify instant publishing via eventBus
    // We should see published events on the eventBus for each chunk addition!
    // Event bus should show the growth:
    const thoughtPublishes = publishedEvents.filter(e => {
      const parsed = JSON.parse(e.data) as Record<string, unknown>;
      return parsed.role === 'thought';
    });

    // One append publish + one final DB flush update = 2 publishes
    expect(thoughtPublishes.length).toBe(2);
    expect((JSON.parse(thoughtPublishes[0].data) as Record<string, unknown>).content).toBe('Thinking');
    expect((JSON.parse(thoughtPublishes[1].data) as Record<string, unknown>).content).toBe('Thinking about logic');

    // Verify metadata presence (timing and token estimates)
    const userMetadata = JSON.parse(userEvent.metadata ?? '{}') as Record<string, unknown>;
    expect(Number(userMetadata.promptTokens)).toBeGreaterThan(0);

    const thoughtMetadata = JSON.parse(thoughtEvent.metadata ?? '{}') as Record<string, unknown>;
    expect(thoughtMetadata.durationMs).toBeDefined();
    expect(thoughtMetadata.completionTokens).toBe(Math.ceil('Thinking about logic'.length / 4));

    const providerMetadata = JSON.parse(providerEvent.metadata ?? '{}') as Record<string, unknown>;
    expect(providerMetadata.durationMs).toBeDefined();
    expect(providerMetadata.completionTokens).toBe(Math.ceil('Hello world'.length / 4));
  });
});
