import { useParams } from 'react-router-dom';
import { SessionConfigProvider, SessionStreamProvider } from '../features/sessions/index.js';
import { SessionWorkspace } from './SessionWorkspace.js';

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
