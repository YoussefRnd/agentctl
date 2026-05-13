import { useParams } from 'react-router-dom';
import { useSessionEvents } from '../hooks/useSessionEvents.js';
import { EventFeed } from '../components/EventFeed.js';
import { CommandBar } from '../components/CommandBar.js';
import { ApprovalCard } from '../components/cards/ApprovalCard.js';

export function SessionView() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const { events, isLoading, sendMessage, isConnected } = useSessionEvents(sessionId ?? null);

  if (!sessionId) return null;
  if (isLoading) return <div className="p-8 text-center text-text-muted">Loading history...</div>;

  const handleSend = (text: string) => {
    sendMessage({ action: 'session.input', sessionId, input: text });
  };

  const handleApprove = (eventId: number) => {
    sendMessage({ action: 'approve', sessionId, eventId });
  };

  const handleDeny = (eventId: number) => {
    sendMessage({ action: 'deny', sessionId, eventId });
  };

  const lastEvent = events[events.length - 1];
  const showApproval = lastEvent?.type === 'approval_request';

  return (
    <div className="flex-1 flex flex-col overflow-hidden relative">
      <div className="flex-1 overflow-hidden pb-32">
        <EventFeed events={events} />
      </div>
      <div className="absolute bottom-0 left-0 right-0">
        {showApproval && (
          <ApprovalCard 
            eventId={lastEvent.id} 
            data={lastEvent.data as { message?: string } | null} 
            onApprove={handleApprove} 
            onDeny={handleDeny} 
          />
        )}
        <CommandBar onSend={handleSend} disabled={!isConnected} />
      </div>
    </div>
  );
}
