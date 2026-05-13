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
  const showApproval = events.length > 0 && lastEvent.type === 'approval_request';

  return (
    <div className="flex-1 flex flex-col overflow-hidden relative">
      <header className="h-14 border-b border-border flex items-center px-6 bg-surface/30 backdrop-blur-sm shrink-0">
        <div className="flex items-center gap-2 text-sm font-medium">
          <span className="text-text-muted">Session:</span>
          <span className="font-mono">{sessionId}</span>
          <span className="px-2 py-0.5 bg-success/20 text-success text-[10px] uppercase font-bold rounded-full tracking-wider">Live</span>
        </div>
      </header>
      <div className="flex-1 overflow-hidden pb-48">
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
