import { useCallback, useEffect, useMemo } from 'react';

/** Schedules DOM work within one owner lifetime; disposed frames cannot target another session. */
export function useFrameScheduler(scope?: string) {
  const owner = useMemo(() => ({ active: true, frames: new Set<number>() }), [scope]);
  useEffect(() => {
    owner.active = true;
    return () => {
      owner.active = false;
      for (const frame of owner.frames) cancelAnimationFrame(frame);
      owner.frames.clear();
    };
  }, [owner]);
  return useCallback(
    (callback: FrameRequestCallback) => {
      if (!owner.active) return;
      const frame = requestAnimationFrame((time) => {
        owner.frames.delete(frame);
        if (owner.active) callback(time);
      });
      owner.frames.add(frame);
    },
    [owner],
  );
}
