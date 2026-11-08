import { describe, it, expect, beforeEach, afterEach, vi } from 'vite-plus/test';
import { createDatabase } from '../db/index.js';
import { SessionEventRepository } from './persistence/session-event-repository.js';
import { eq } from 'drizzle-orm';
import { projects, sessions, sessionEventChanges } from '../db/schema.js';
import { buildConversationHistoryTranscript } from './history-transcript.js';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { DbClient } from '../db/index.js';

describe('buildConversationHistoryTranscript', () => {
  let db: DbClient;
  let home: string;

  beforeEach(async () => {
    home = await fs.mkdtemp(path.join(os.tmpdir(), 'agentctl-history-test-'));
    vi.stubEnv('AGENTCTL_HOME', home);
    db = createDatabase(':memory:');
    await db.insert(projects).values({
      id: 'proj-1',
      name: 'test-project',
      path: '/tmp/test',
    });
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await fs.rm(home, { recursive: true, force: true });
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

    const transcript = await buildConversationHistoryTranscript(db, 'sess-empty', {
      afterSequence: 0,
      maxBytes: 4_000,
    });
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
      afterSequence: 0,
      maxBytes: 4_000,
    });

    expect(transcript).toContain('<previous_conversation_context>');
    expect(transcript).toContain('[User]: Create a login form');
    expect(transcript).toContain('[Assistant]: I created src/components/LoginForm.tsx.');
    expect(transcript).toContain('[User]: Add validation to it');
    expect(transcript).toContain('</previous_conversation_context>');
  });

  it('transfers missed activity without reasoning, undelivered messages, or the current request', async () => {
    await db.insert(sessions).values({
      id: 'activity',
      projectId: 'proj-1',
      branch: 'main',
      worktreePath: '/tmp/test',
      taskSlug: 'activity',
      agent: 'source',
      selectedProvider: 'target',
      baseCommit: 'hash',
    });
    const store = new SessionEventRepository(db, { publish() {} });
    const anchor = await store.append('activity', 'text', {
      role: 'user',
      content: 'Already seen',
    });
    await store.append('activity', 'text', { role: 'user', content: 'Missed request' });
    await store.append('activity', 'text', { role: 'thought', content: 'Private reasoning' });
    for (const deliveryStatus of ['queued', 'cancelled', 'failed', 'unknown'] as const)
      await store.append('activity', 'text', {
        role: 'user',
        content: `Undelivered ${deliveryStatus}`,
        deliveryStatus,
      });
    await store.append('activity', 'tool_call', {
      name: 'test',
      status: 'failed',
      rawOutput: { exitCode: 1, output: 'Command failed' },
    });
    await store.append('activity', 'tool_call', {
      name: 'reason',
      kind: 'think',
      rawOutput: 'Hidden reasoning',
    });
    await store.append('activity', 'text', { role: 'provider', content: '界🧪'.repeat(2_000) });
    await store.append('activity', 'text', { role: 'provider', content: 'Latest answer' });
    const current = await store.append('activity', 'text', {
      role: 'user',
      content: 'Current request',
    });
    const change = db
      .select()
      .from(sessionEventChanges)
      .where(eq(sessionEventChanges.eventId, anchor))
      .get()!;
    await store.append(
      'activity',
      'text',
      { role: 'provider', content: 'Current tool output' },
      current,
    );
    const context = await buildConversationHistoryTranscript(db, 'activity', {
      afterSequence: change.sequence,
      excludeEventId: current,
      maxBytes: 4_000,
    });
    expect(context).toContain('Missed request');
    expect(context).toContain('Command failed');
    expect(context).toContain('Latest answer');
    for (const excluded of [
      'Already seen',
      'Private reasoning',
      'Hidden reasoning',
      'Undelivered',
      'Current request',
      'Current tool output',
      '界🧪',
    ])
      expect(context).not.toContain(excluded);
    expect(Buffer.byteLength(JSON.stringify(context)) + 256).toBeLessThanOrEqual(4_000);
    const filePath = context!.match(/at (.+?\.md) if needed/)![1];
    try {
      expect(await fs.readFile(filePath, 'utf8')).toContain('界🧪'.repeat(2_000));
    } finally {
      await fs.unlink(filePath);
    }
  });
});
