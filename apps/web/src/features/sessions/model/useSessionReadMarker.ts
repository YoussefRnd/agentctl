import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { patchSession } from '@agentctl/api-client';
import { projectKeys } from '@/shared/lib/queryKeys';

/** Acknowledge only rendered, current history in a foreground chat, never prefetched pages. */
export function useSessionReadMarker(sessionId: string, eventId: number, enabled: boolean) {
  const queryClient = useQueryClient();
  const acknowledged = useRef({ sessionId, eventId: 0 });
  useEffect(() => {
    let disposed = false;
    let pending = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const acknowledge = () => {
      clearTimeout(timer);
      if (!enabled || !eventId || document.visibilityState !== 'visible' || !document.hasFocus())
        return;
      if (acknowledged.current.sessionId === sessionId && acknowledged.current.eventId >= eventId)
        return;
      timer = setTimeout(() => {
        if (pending || disposed || document.visibilityState !== 'visible' || !document.hasFocus())
          return;
        pending = true;
        void patchSession(sessionId, { lastReadEventId: eventId })
          .then(() => {
            if (disposed) return;
            acknowledged.current = { sessionId, eventId };
            void queryClient.invalidateQueries({ queryKey: projectKeys.all });
          })
          .catch(() => {
            // A visibility/focus change or new history retries; keep unread on failure.
          })
          .finally(() => {
            pending = false;
          });
      }, 400);
    };
    acknowledge();
    document.addEventListener('visibilitychange', acknowledge);
    window.addEventListener('focus', acknowledge);
    window.addEventListener('blur', acknowledge);
    return () => {
      disposed = true;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', acknowledge);
      window.removeEventListener('focus', acknowledge);
      window.removeEventListener('blur', acknowledge);
    };
  }, [sessionId, eventId, enabled, queryClient]);
}
