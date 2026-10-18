import { afterEach, expect, it, vi } from 'vite-plus/test';
import { MarkdownWorker } from './markdownWorker';
import type { MarkdownResult } from './markdownProcessor';

function fixture() {
  const worker = {
    postMessage: vi.fn(),
    terminate: vi.fn(),
    onmessage: null as ((event: MessageEvent<MarkdownResult>) => void) | null,
    onerror: null as (() => void) | null,
    onmessageerror: null as (() => void) | null,
  };
  const broker = new MarkdownWorker(() => worker as unknown as Worker);
  const complete = (id: number) =>
    worker.onmessage!({
      data: { id, tree: { type: 'root', children: [] } },
    } as unknown as MessageEvent<MarkdownResult>);
  return { worker, broker, complete };
}
afterEach(() => vi.useRealTimers());

it('deduplicates active work and releases completed documents', () => {
  const { worker, broker, complete } = fixture();
  const first = vi.fn(),
    second = vi.fn();
  broker.subscribe('same', first);
  broker.subscribe('same', second);
  expect(worker.postMessage).toHaveBeenCalledTimes(1);
  complete(1);
  expect(first).toHaveBeenCalledOnce();
  expect(second).toHaveBeenCalledOnce();
  broker.subscribe('same', first);
  expect(worker.postMessage).toHaveBeenCalledTimes(2);
  complete(2);
});

it('drops cancelled queued work and never delivers stale active results', () => {
  const { worker, broker, complete } = fixture();
  const stale = vi.fn(),
    current = vi.fn();
  const cancelActive = broker.subscribe('old', stale);
  const cancelQueued = broker.subscribe('unused', stale);
  broker.subscribe('new', current);
  cancelActive();
  cancelQueued();
  complete(1);
  expect(stale).not.toHaveBeenCalled();
  expect(worker.postMessage.mock.calls).toEqual([
    [{ id: 1, content: 'old' }],
    [{ id: 3, content: 'new' }],
  ]);
  complete(1); // A stale message cannot satisfy the new request.
  expect(current).not.toHaveBeenCalled();
  complete(3);
  expect(current).toHaveBeenCalledOnce();
});

it.each(['onerror', 'onmessageerror'] as const)(
  'falls back for current and future work after %s',
  (errorEvent) => {
    const { worker, broker } = fixture();
    const fallback = vi.fn();
    broker.subscribe('active', fallback);
    broker.subscribe('queued', fallback);
    worker[errorEvent]!();
    broker.subscribe('later', fallback);
    expect(fallback.mock.calls).toEqual([[null], [null], [null]]);
    expect(worker.terminate).toHaveBeenCalledOnce();
  },
);

it('falls back if construction fails or a worker stops responding', () => {
  vi.useFakeTimers();
  const fallback = vi.fn();
  new MarkdownWorker(() => {
    throw new Error('unavailable');
  }).subscribe('text', fallback);
  const { broker, worker } = fixture();
  broker.subscribe('text', fallback);
  vi.advanceTimersByTime(15000);
  expect(fallback.mock.calls).toEqual([[null], [null]]);
  expect(worker.terminate).toHaveBeenCalledOnce();
});

it('allows a parse error to fall back without blocking the next document', () => {
  const { broker, worker, complete } = fixture();
  const fallback = vi.fn(),
    next = vi.fn();
  broker.subscribe('invalid', fallback);
  broker.subscribe('valid', next);
  worker.onmessage!({
    data: { id: 1, error: 'parse failed' },
  } as unknown as MessageEvent<MarkdownResult>);
  expect(fallback).toHaveBeenCalledWith(null);
  complete(2);
  expect(next).toHaveBeenCalledOnce();
});
