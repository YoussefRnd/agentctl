import { useParams } from 'react-router-dom';
import { SessionWorkspace } from '../components/SessionWorkspace.js';

export function SessionView() {
  const { sessionId } = useParams<{ sessionId: string }>();
  if (!sessionId) return null;

  return <SessionWorkspace sessionId={sessionId} />;
}
