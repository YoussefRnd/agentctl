import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, test, vi } from 'vite-plus/test';
import { useFrameScheduler } from './useFrameScheduler';

test('cancels pending focus work when switching sessions or disposing its owner', () => {
  const frames = new Map<number, FrameRequestCallback>();
  let sequence = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++sequence, callback);
    return sequence;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  let schedule: ReturnType<typeof useFrameScheduler>;
  function Harness({ session }: { session: string }) {
    schedule = useFrameScheduler(session);
    return null;
  }
  const root = createRoot(document.createElement('div'));
  const focus = vi.fn();
  try {
    act(() => root.render(<Harness session="a" />));
    const previousSession = schedule!;
    schedule!(focus);
    expect(frames.size).toBe(1);
    act(() => root.render(<Harness session="b" />));
    expect(frames.size).toBe(0);
    previousSession(focus);
    expect(frames.size).toBe(0);
    schedule!(focus);
    act(() => root.unmount());
    expect(frames.size).toBe(0);
    schedule!(focus);
    expect(frames.size).toBe(0);
    expect(focus).not.toHaveBeenCalled();
  } finally {
    vi.unstubAllGlobals();
  }
});
