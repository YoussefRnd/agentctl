import { useMemo } from 'react';
import { useSession, useSessionStream } from './SessionContext';
import { getSessionTurnState } from './sessionTurnState';

export function useSessionTurnState() {
  const { sessionData } = useSession();
  const { events, execution } = useSessionStream();
  return useMemo(
    () => getSessionTurnState(events, sessionData?.session.status, execution),
    [events, sessionData?.session.status, execution],
  );
}
