import { test, expect, describe } from 'vitest';
import { createDatabase } from '../db/index.js';
import { projects, sessions, sessionEvents } from '../db/schema.js';
import { ManagedSession } from './managed-session.js';
import { SessionEventStore } from './event-store.js';
import { eq } from 'drizzle-orm';
import type { AgentSession } from '../agent/types.js';

describe('ManagedSession Observability & StreamBuffer Integration', () => {
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
      title: 'Test Obs',
      agent: 'claude-acp',
      selectedProvider: 'claude-acp',
      baseCommit: 'hash',
    });

    const publishedEvents: {
      id: number;
      sessionId: string;
      type: string;
      data: string;
      createdAt: Date;
      delta?: string;
    }[] = [];
    const eventBus = {
      publish: (evt: {
        id: number;
        sessionId: string;
        type: string;
        data: string;
        createdAt: Date;
        delta?: string;
      }) => {
        publishedEvents.push(evt);
      },
      subscribe: () => () => {
        /* noop */
      },
    };

    const eventStore = new SessionEventStore(db, eventBus);

    // Mock runtime handle
    let promptCallback: (() => Promise<void>) | null = null;
    const fakeRuntimeHandle = {
      id: 'acp-obs-123',
      history: 'fresh',
      closed: new Promise<void>(() => {
        /* noop */
      }),
      onError: () => {
        /* noop */
      },
      onClose: () => {
        /* noop */
      },
      prompt: async () => {
        if (promptCallback) {
          await promptCallback();
        }
        return { stopReason: 'end_turn' };
      },
      close: async () => {
        /* noop */
      },
      updateModel: async () => {
        /* noop */
      },
      updateConfigOption: () => [],
    } as unknown as AgentSession;

    const session = new ManagedSession(
      'sess-obs',
      fakeRuntimeHandle,
      db,
      eventStore,
      '/tmp/proj-obs',
    );

    // Set up what happens during runtime handle prompt
    let snapshotsMidStream: ReturnType<ManagedSession['getLiveEventSnapshots']> = [];
    promptCallback = async () => {
      // 1. Send thought chunks
      await session.handleDomainEvent({ type: 'thought', text: 'Thinking' });
      await session.handleDomainEvent({ type: 'thought', text: ' about' });
      await session.handleDomainEvent({ type: 'thought', text: ' logic' });

      // 2. Send text chunks
      await session.handleDomainEvent({ type: 'text', text: 'Hello' });
      await session.handleDomainEvent({ type: 'text', text: ' world' });

      // 3. Capture transient snapshots while events are still in flight
      snapshotsMidStream = session.getLiveEventSnapshots();
    };

    // Execute prompt
    await session.prompt('Test prompt');

    const renamedSession = await db.query.sessions.findFirst({
      where: eq(sessions.id, 'sess-obs'),
    });
    expect(renamedSession?.title).toBe('Test prompt');

    // Retrieve events from DB to assert their state
    const dbEvents = await db
      .select()
      .from(sessionEvents)
      .where(eq(sessionEvents.sessionId, 'sess-obs'));

    // We expect 3 distinct text events recorded in DB:
    // 1. User prompt (type: 'text', role: 'user')
    // 2. Thought event (type: 'text', role: 'thought')
    // 3. Response event (type: 'text', role: 'provider')
    const textEvents = dbEvents.filter((e) => e.type === 'text');
    expect(textEvents.length).toBe(3);

    const userEvent = textEvents.find((e) => {
      const parsed = JSON.parse(e.data) as Record<string, unknown>;
      return parsed.role === 'user';
    });
    const thoughtEvent = textEvents.find((e) => {
      const parsed = JSON.parse(e.data) as Record<string, unknown>;
      return parsed.role === 'thought';
    });
    const providerEvent = textEvents.find((e) => {
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
    expect((JSON.parse(thoughtEvent.data) as Record<string, unknown>).content).toBe(
      'Thinking about logic',
    );
    expect((JSON.parse(providerEvent.data) as Record<string, unknown>).content).toBe('Hello world');

    // Verify publishing via eventBus: append + transient delta stream,
    // DB writes happen silently (no publish on flush).
    const thoughtPublishes = publishedEvents.filter((e) => {
      const parsed = JSON.parse(e.data) as Record<string, unknown>;
      return parsed.role === 'thought';
    });

    expect(thoughtPublishes.length).toBeGreaterThanOrEqual(2);
    // First chunk goes through the persisted append path: full content, no delta
    expect((JSON.parse(thoughtPublishes[0].data) as Record<string, unknown>).content).toBe(
      'Thinking',
    );
    expect(thoughtPublishes[0].delta).toBeUndefined();
    // Subsequent chunks ride the transient path: wire-only delta, empty content
    const combinedTransientThoughtDelta = thoughtPublishes
      .slice(1)
      .map((p) => p.delta ?? '')
      .join('');
    expect(combinedTransientThoughtDelta).toBe(' about logic');

    const providerPublishes = publishedEvents.filter((e) => {
      const parsed = JSON.parse(e.data) as Record<string, unknown>;
      return parsed.role === 'provider';
    });
    expect(providerPublishes.length).toBeGreaterThanOrEqual(2);
    expect((JSON.parse(providerPublishes[0].data) as Record<string, unknown>).content).toBe(
      'Hello',
    );
    expect(providerPublishes[0].delta).toBeUndefined();
    const combinedTransientProviderDelta = providerPublishes
      .slice(1)
      .map((p) => p.delta ?? '')
      .join('');
    expect(combinedTransientProviderDelta).toBe(' world');

    // Verify metadata presence (timing)
    const thoughtMetadata = JSON.parse(thoughtEvent.metadata ?? '{}') as Record<string, unknown>;
    expect(thoughtMetadata.durationMs).toBeDefined();

    const providerMetadata = JSON.parse(providerEvent.metadata ?? '{}') as Record<string, unknown>;
    expect(providerMetadata.durationMs).toBeDefined();

    // Verify transient snapshots: full content, no delta, available mid-stream
    expect(snapshotsMidStream.length).toBe(2);
    const snapThought = snapshotsMidStream.find((s) => {
      const parsed = JSON.parse(s.data) as Record<string, unknown>;
      return parsed.role === 'thought';
    });
    const snapProvider = snapshotsMidStream.find((s) => {
      const parsed = JSON.parse(s.data) as Record<string, unknown>;
      return parsed.role === 'provider';
    });
    expect(snapThought).toBeDefined();
    expect(snapProvider).toBeDefined();
    expect((JSON.parse(snapThought?.data ?? '{}') as Record<string, unknown>).content).toBe(
      'Thinking about logic',
    );
    expect((JSON.parse(snapProvider?.data ?? '{}') as Record<string, unknown>).content).toBe(
      'Hello world',
    );
    expect(snapThought).not.toHaveProperty('delta');
    expect(snapProvider).not.toHaveProperty('delta');
    expect(snapThought?.id).toBe(thoughtEvent.id);
    expect(snapProvider?.id).toBe(providerEvent.id);
  });
});
