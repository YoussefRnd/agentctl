import assert from 'node:assert/strict';
import { sessionOperations, sessionTurnAttempts } from '@agentctl/core/db';
import { eq } from 'drizzle-orm';
import { createBackendFixture, waitUntil } from './fixture.js';

const [stage, database] = process.argv.slice(2);
assert(stage === 'accept' || stage === 'recover');
const context = await createBackendFixture({ sessions: 5, database, seed: stage === 'accept' });
if (stage === 'accept') {
  await context.pause();
  await Promise.all(
    context.ids.map(async (id) => {
      for (let turn = 0; turn < 3; turn++) await context.send(id, `recovered turn ${turn}`);
    }),
  );
  // Crash at two durable boundaries: claimed before dispatch, and dispatched without an outcome.
  for (const [index, id] of context.ids.slice(0, 2).entries()) {
    const operation = context.operations().find((row) => row.sessionId === id)!;
    context.db
      .update(sessionOperations)
      .set({ status: 'running' })
      .where(eq(sessionOperations.id, operation.id))
      .run();
    context.db
      .update(sessionTurnAttempts)
      .set({ status: 'running', dispatchedAt: index === 0 ? new Date() : null })
      .where(eq(sessionTurnAttempts.operationId, operation.id))
      .run();
  }
  assert.equal(context.operations().length, 15);
  assert.equal(context.dispatches.length, 0);
  // Deliberately skip app/runtime shutdown. OS exit closes sockets and the SQLite connection.
  process.exit(0);
}
try {
  context.setIdle();
  await context.worker.recover();
  await waitUntil(
    () => context.operations().filter((row) => row.status === 'succeeded').length === 12,
    '12 safe recovered turns',
  );
  const uncertain = context.operations().filter((row) => row.sessionId === context.ids[0]);
  assert.deepEqual(
    uncertain.map((row) => row.status),
    ['unknown', 'pending', 'pending'],
  );
  assert.equal(context.dispatches.length, 12);
  assert(context.dispatches.every((row) => row.sessionId !== context.ids[0]));
  await assert.rejects(context.worker.resumeQueue(context.ids[0]), /uncertain/);
  const original = uncertain[0];
  await context.send(
    original.sessionId,
    (JSON.parse(original.payload) as { text: string }).text,
    original.commandId,
  );
  assert.equal(context.operations().length, 15, 'Lost acknowledgement retries must reuse receipts');
  assert.equal(context.dispatches.length, 12);
} finally {
  await context.close();
}
