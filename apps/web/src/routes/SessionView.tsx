import { useParams } from 'react-router-dom';
import { useSessionEvents } from '../hooks/useSessionEvents.js';
import { EventFeed } from '../components/EventFeed.js';

export function SessionView() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const { events, isLoading } = useSessionEvents(sessionId ?? null);

  if (!sessionId) return null;
  if (isLoading) return <div className="p-8 text-center text-text-muted">Loading history...</div>;

  return <EventFeed events={events} />;
}
