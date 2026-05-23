import { useParams } from 'react-router-dom';
import { SessionWorkspace } from '../features/session/components/SessionWorkspace';
import { SessionProvider } from '../contexts/SessionContext';

export function SessionView() {
 const { sessionId } = useParams<{ sessionId: string }>();
 if (!sessionId) return null;

 return (
  <SessionProvider sessionId={sessionId}>
   <SessionWorkspace />
  </SessionProvider>
 );
}
