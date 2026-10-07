import { expect, it, vi } from 'vitest';
import { PerformanceRecorder, afterPaint } from './performanceRecorder';

it('is inactive unless opted in', () => {
  const recorder = new PerformanceRecorder(false);
  recorder.begin('launch-to-typeable');
  recorder.finish('launch-to-typeable');
  expect(recorder.snapshot()).toEqual([]);
});

it('correlates scopes, finishes once, and exports no scope or mutable references', () => {
  let now = 10;
  const recorder = new PerformanceRecorder(true, () => now);
  recorder.begin('session-click-to-feed-painted', 'private-session-id');
  now = 30;
  recorder.finish('session-click-to-feed-painted', 'other-session');
  expect(recorder.snapshot()).toEqual([]);
  recorder.finish('session-click-to-feed-painted', 'private-session-id');
  recorder.finish('session-click-to-feed-painted', 'private-session-id');
  const snapshot = recorder.snapshot();
  expect(snapshot).toEqual([
    { name: 'session-click-to-feed-painted', startTime: 10, durationMs: 20 },
  ]);
  snapshot[0].durationMs = 0;
  expect(recorder.snapshot()[0].durationMs).toBe(20);
});

it('bounds retained samples and discards cancelled journeys', () => {
  const recorder = new PerformanceRecorder(true, () => 100);
  for (let i = 0; i < 250; i++) {
    recorder.begin('launch-to-typeable');
    recorder.finish('launch-to-typeable');
  }
  expect(recorder.snapshot()).toHaveLength(200);
  recorder.begin('launch-to-typeable');
  recorder.cancel('launch-to-typeable');
  recorder.clear();
  recorder.finish('launch-to-typeable');
  expect(recorder.snapshot()).toEqual([]);
});

it('waits for two frames and can cancel a pending paint callback', () => {
  const callbacks: FrameRequestCallback[] = [];
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
    callbacks.push(callback),
  );
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  const callback = vi.fn();
  const cancel = afterPaint(callback);
  callbacks.shift()!(0);
  expect(callback).not.toHaveBeenCalled();
  cancel();
  callbacks.shift()!(16);
  expect(callback).not.toHaveBeenCalled();
  afterPaint(callback);
  callbacks.shift()!(32);
  callbacks.shift()!(48);
  expect(callback).toHaveBeenCalledOnce();
  vi.unstubAllGlobals();
});
