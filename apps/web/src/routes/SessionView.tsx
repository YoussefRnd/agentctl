import { useParams } from 'react-router-dom';
import { SessionWorkspace } from '../features/session/components/SessionWorkspace';
import { SessionConfigProvider, SessionStreamProvider } from '../contexts/SessionContext';

export function SessionView() {
  const { sessionId } = useParams<{ sessionId: string }>();
  if (!sessionId) return null;

  return (
    <SessionConfigProvider key={`config-${sessionId}`} sessionId={sessionId}>
      <SessionStreamProvider key={`stream-${sessionId}`} sessionId={sessionId}>
        <SessionWorkspace />
      </SessionStreamProvider>
    </SessionConfigProvider>
  );
}
