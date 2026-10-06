import { expect, test } from 'vitest';
import type { SessionEventRow, SessionExecution } from '@agentctl/shared';
import { getSessionTurnState } from './sessionTurnState';

const user = (
  id: number,
  deliveryStatus: 'sending' | 'accepted' | 'queued' = 'accepted',
): SessionEventRow => ({
  id,
  sessionId: 's',
  type: 'text',
  data: { role: 'user', content: 'hello', deliveryStatus },
  metadata: { attemptId: `attempt-${id}` },
  createdAt: new Date(1000),
});
const execution = (
  state: SessionExecution['execution'],
  connection: SessionExecution['connection'] = 'connected',
): SessionExecution => ({
  execution: state,
  connection,
  attention: 'none',
  attemptId: 'attempt-1',
  queue: [],
});

test('keeps pending input visible through an idle refresh during provider startup', () => {
  expect(getSessionTurnState([user(1)], 'idle', execution('running', 'disconnected'))?.phase).toBe(
    'starting',
  );
  expect(getSessionTurnState([user(1)], 'idle', execution('running'))?.phase).toBe('waiting');
  expect(getSessionTurnState([user(-1, 'sending')], 'idle')?.phase).toBe('sending');
});
test.each(['completed', 'cancelled', 'failed', 'unknown', 'interrupted'] as const)(
  'stops indicating progress for a %s attempt even before its final event arrives',
  (state) => {
    expect(getSessionTurnState([user(1)], 'idle', execution(state))).toBeNull();
  },
);
test('keeps active work distinct from a newly queued message', () => {
  expect(
    getSessionTurnState([user(1), user(2, 'queued')], 'idle', execution('running'))?.phase,
  ).toBe('waiting');
});
test('does not let the previous attempt completion hide a fresh send', () => {
  expect(
    getSessionTurnState([user(1), user(-2, 'sending')], 'idle', execution('completed'))?.phase,
  ).toBe('sending');
});
test('removes the waiting state after turn completion and failures', () => {
  const end: SessionEventRow = {
    id: 2,
    sessionId: 's',
    type: 'status',
    data: { status: 'turn_end' },
    createdAt: new Date(),
  };
  expect(getSessionTurnState([user(1), end], 'running')).toBeNull();
  expect(getSessionTurnState([user(1)], 'error')).toBeNull();
});

test('shows provider retry hints, preserves them through unrelated updates, and clears them for the next step', () => {
  const retry = {
    attempt: 2,
    nextRetryAt: '2026-10-05T13:59:09.425Z',
    message: 'Provider request failed with HTTP 504',
    httpStatus: 504,
  };
  const info = (id: number, data: Record<string, unknown>): SessionEventRow => ({
    id,
    sessionId: 's',
    type: 'status',
    data: { status: 'session_info_update', ...data },
    createdAt: new Date(),
  });
  const events = [user(1), info(2, { retry }), info(3, { title: 'hey' })];
  expect(getSessionTurnState(events, 'running')).toMatchObject({
    phase: 'retrying',
    retry,
    canCancel: true,
  });
  expect(getSessionTurnState([...events, info(4, { retry: null })], 'running')).toMatchObject({
    phase: 'waiting',
  });
  expect(getSessionTurnState([...events, info(4, { retry: null })], 'running')).not.toHaveProperty(
    'retry',
  );
  expect(getSessionTurnState([user(1), info(2, { retry: { attempt: 2 } })], 'running')?.phase).toBe(
    'waiting',
  );
  expect(
    getSessionTurnState([user(1), info(2, { retry }), user(-3, 'sending')], 'idle')?.phase,
  ).toBe('sending');
});
