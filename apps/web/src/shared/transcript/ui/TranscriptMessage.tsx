import type { SessionEventTextData } from '@agentctl/shared';
import { StreamingMarkdown } from '@/shared/markdown/ui/StreamingMarkdown';

export function sessionMessageParticipant(data: SessionEventTextData) {
  const outgoing = data.senderSessionId === data.transcriptSessionId;
  const incoming = data.recipientSessionId === data.transcriptSessionId;
  const participantId = outgoing
    ? data.recipientSessionId
    : incoming
      ? data.senderSessionId
      : undefined;
  return participantId;
}

/** Read-only communication display; its owner supplies navigation when a participant is known. */
export function TranscriptMessage({
  data,
  participantName,
  onSelectParticipant,
}: {
  data: SessionEventTextData;
  participantName?: string;
  onSelectParticipant?: () => void;
}) {
  const participantId = sessionMessageParticipant(data);
  const outgoing = data.senderSessionId === data.transcriptSessionId;
  const incoming = data.recipientSessionId === data.transcriptSessionId;
  const name = participantName ?? participantId;
  const direction = outgoing ? 'To' : incoming ? 'From' : undefined;
  return (
    <section
      aria-label={direction && name ? `${direction} ${name}` : 'Session message'}
      className="border-border/30 border-l-2 pl-3"
    >
      <p className="text-text-muted mb-1 text-xs">
        {direction && name ? (
          <>
            {direction}{' '}
            {onSelectParticipant ? (
              <button
                type="button"
                className="text-accent hover:underline"
                onClick={onSelectParticipant}
              >
                {name}
              </button>
            ) : (
              name
            )}
          </>
        ) : (
          'Session message'
        )}
      </p>
      {data.content && (
        <div className="prose prose-invert max-w-none text-sm">
          <StreamingMarkdown content={data.content} />
        </div>
      )}
    </section>
  );
}
