import { useCallback, useEffect, useRef } from 'react';

/** Schedules DOM work within one owner lifetime; disposed frames cannot target another session. */
export function useFrameScheduler(scope?: string) {
  const frames = useRef(new Set<number>());
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      for (const frame of frames.current) cancelAnimationFrame(frame);
      frames.current.clear();
    };
  }, [scope]);
  return useCallback((callback: FrameRequestCallback) => {
    if (!active.current) return;
    const frame = requestAnimationFrame((time) => {
      frames.current.delete(frame);
      if (active.current) callback(time);
    });
    frames.current.add(frame);
  }, []);
}
