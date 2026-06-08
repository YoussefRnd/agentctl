import { useSession, useSessionStream } from '../contexts/SessionContext';

export function useSessionActions() {
  const { sessionId } = useSession();
  const { sendMessage } = useSessionStream();

  const handleSend = (text: string) => {
    if (!text.trim()) return;
    sendMessage({ action: 'session.input', sessionId, input: text });
  };

  const handleApprove = (eventId: number) => {
    sendMessage({ action: 'approve', sessionId, eventId });
  };

  const handleDeny = (eventId: number) => {
    sendMessage({ action: 'deny', sessionId, eventId });
  };

  return {
    handleSend,
    handleApprove,
    handleDeny,
  };
}

