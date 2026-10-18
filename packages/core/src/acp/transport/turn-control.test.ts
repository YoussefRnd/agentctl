import { expect, test, vi } from 'vite-plus/test';
import type { AgentSession } from '../../agent/types.js';
import { guardAcpTurns } from './turn-control.js';

function setup() {
  let complete!: () => void;
  const prompt = vi.fn(
    () =>
      new Promise<{ stopReason: 'cancelled' }>((resolve) => {
        complete = () => resolve({ stopReason: 'cancelled' });
      }),
  );
  const retire = vi.fn();
  const session = {
    prompt,
    cancel: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
  } as unknown as AgentSession;
  guardAcpTurns(session, retire, { timeoutMs: 30 });
  return { session, prompt, retire, complete: () => complete() };
}

test('replacement prompt waits for cancelled prompt to finish', async () => {
  const h = setup();
  const first = h.session.prompt('first');
  await Promise.resolve();
  const cancellation = h.session.cancel();
  const second = h.session.prompt('second');
  await Promise.resolve();
  expect(h.prompt).toHaveBeenCalledTimes(1);
  h.complete();
  await first;
  await cancellation;
  await Promise.resolve();
  expect(h.prompt).toHaveBeenCalledTimes(2);
  h.complete();
  await second;
  expect(h.retire).not.toHaveBeenCalled();
});

test('unresponsive cancellation retires runtime and prevents further prompts', async () => {
  const h = setup();
  const first = h.session.prompt('first');
  const failed = expect(first).rejects.toThrow('session closed');
  await Promise.resolve();
  await expect(h.session.cancel()).rejects.toThrow('runtime was stopped');
  expect(h.retire).toHaveBeenCalledOnce();
  await expect(h.session.prompt('second')).rejects.toThrow('runtime stopped');
  h.complete();
  await failed;
});

test('closing a session rejects an active prompt, is idempotent, and forbids new prompts', async () => {
  const h = setup();
  const first = h.session.prompt('first');
  const failed = expect(first).rejects.toThrow('session closed');
  await Promise.resolve();
  await Promise.all([h.session.close(), h.session.close()]);
  await failed;
  await expect(h.session.prompt('second')).rejects.toThrow('session closed');
  expect(h.prompt).toHaveBeenCalledOnce();
  h.complete();
});

test('connection failure retains process diagnostics on the pending prompt', async () => {
  let failConnection!: (error: Error) => void;
  const session = {
    prompt: vi.fn(() => new Promise<never>(() => {})),
    cancel: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
    closed: new Promise<void>((_, reject) => {
      failConnection = reject;
    }),
  } as unknown as AgentSession;
  guardAcpTurns(session, vi.fn());
  const pending = session.prompt('first');
  const error = new Error('Process exited with code 1: missing configuration');
  const failed = expect(pending).rejects.toBe(error);
  await Promise.resolve();
  failConnection(error);
  await failed;
  await session.close();
});
