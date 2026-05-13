import { useParams } from 'react-router-dom';
import { useSessionEvents } from '../hooks/useSessionEvents.js';
import { EventFeed } from '../components/EventFeed.js';
import { CommandBar } from '../components/CommandBar.js';

export function SessionView() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const { events, isLoading, sendMessage } = useSessionEvents(sessionId ?? null);

  if (!sessionId) return null;
  if (isLoading) return <div className="p-8 text-center text-text-muted">Loading history...</div>;

  const handleSend = (text: string) => {
    sendMessage({ action: 'session.input', sessionId, input: text });
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden relative">
      <EventFeed events={events} />
      <div className="absolute bottom-0 left-0 right-0">
        <CommandBar onSend={handleSend} />
      </div>
    </div>
  );
}
