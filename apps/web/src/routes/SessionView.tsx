import { useParams } from 'react-router-dom';
import { SessionWorkspace } from '../features/session/components/SessionWorkspace';
import { SessionConfigProvider, SessionStreamProvider } from '../contexts/SessionContext';

export function SessionView() {
  const { sessionId } = useParams<{ sessionId: string }>();
  if (!sessionId) return null;

  return (
    <SessionConfigProvider sessionId={sessionId}>
      <SessionStreamProvider sessionId={sessionId}>
        <SessionWorkspace />
      </SessionStreamProvider>
    </SessionConfigProvider>
  );
}

