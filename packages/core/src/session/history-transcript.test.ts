import { describe, it, expect, beforeEach } from 'vite-plus/test';
import { createDatabase } from '../db/index.js';
import { SessionEventRepository } from './persistence/session-event-repository.js';
import { projects, sessions } from '../db/schema.js';
import { buildConversationHistoryTranscript } from './history-transcript.js';
import type { DbClient } from '../db/index.js';

describe('buildConversationHistoryTranscript', () => {
  let db: DbClient;

  beforeEach(async () => {
    db = createDatabase(':memory:');
    await db.insert(projects).values({
      id: 'proj-1',
      name: 'test-project',
      path: '/tmp/test',
    });
  });

  it('returns null if there are no prior text messages in history', async () => {
    await db.insert(sessions).values({
      id: 'sess-empty',
      projectId: 'proj-1',
      branch: 'main',
      worktreePath: '/tmp/test',
      taskSlug: 'test',
      agent: 'test',
      title: 'empty',
      status: 'idle',
      selectedProvider: 'claude-acp',
      baseCommit: 'hash',
    });

    const transcript = await buildConversationHistoryTranscript(db, 'sess-empty');
    expect(transcript).toBeNull();
  });

  it('formats recent user and assistant text events into XML-wrapped transcript', async () => {
    await db.insert(sessions).values({
      id: 'sess-history',
      projectId: 'proj-1',
      branch: 'main',
      worktreePath: '/tmp/test',
      taskSlug: 'test',
      agent: 'test',
      title: 'history',
      status: 'idle',
      selectedProvider: 'claude-acp',
      baseCommit: 'hash',
    });

    const store = new SessionEventRepository(db, {
      publish() {
        /* noop */
      },
    });
    await store.append('sess-history', 'text', { text: 'Create a login form', role: 'user' }, null);
    await store.append(
      'sess-history',
      'text',
      { text: 'I created src/components/LoginForm.tsx.', role: 'provider' },
      null,
    );
    await store.append(
      'sess-history',
      'text',
      { text: 'Add validation to it', role: 'user' },
      null,
    );

    const transcript = await buildConversationHistoryTranscript(db, 'sess-history', {
      maxTurns: 10,
    });

    expect(transcript).toContain('<previous_conversation_context>');
    expect(transcript).toContain('[User]: Create a login form');
    expect(transcript).toContain('[Assistant]: I created src/components/LoginForm.tsx.');
    expect(transcript).toContain('[User]: Add validation to it');
    expect(transcript).toContain('</previous_conversation_context>');
  });

  it('respects maxTurns while retaining the original request', async () => {
    await db.insert(sessions).values({
      id: 'sess-long',
      projectId: 'proj-1',
      branch: 'main',
      worktreePath: '/tmp/test',
      taskSlug: 'test',
      agent: 'test',
      title: 'long',
      status: 'idle',
      selectedProvider: 'claude-acp',
      baseCommit: 'hash',
    });

    const store = new SessionEventRepository(db, {
      publish() {
        /* noop */
      },
    });
    for (let i = 1; i <= 15; i++) {
      await store.append(
        'sess-long',
        'text',
        { text: `User message ${String(i)}`, role: 'user' },
        null,
      );
      await store.append(
        'sess-long',
        'text',
        { text: `Assistant response ${String(i)}`, role: 'provider' },
        null,
      );
    }

    const transcript = await buildConversationHistoryTranscript(db, 'sess-long', { maxTurns: 4 });

    expect(transcript).toContain('[User]: User message 1');
    expect(transcript).not.toContain('[User]: User message 14');
    expect(transcript).toContain('[User]: User message 15');
    expect(transcript).not.toContain('[User]: User message 10');
  });
});
