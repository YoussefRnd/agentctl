import type { SessionEventTextData } from '@agentctl/shared';
import { useSession, useSessionStream } from '@/features/sessions';
import { useSubagentStore } from '@/features/subagents';
import { StreamingMarkdown } from './StreamingMarkdown';

/** Reported communication between ACP sessions, distinct from answers to the user. */
export function SessionMessage({ data }: { data: SessionEventTextData }) {
  const { sessionId } = useSession();
  const { events } = useSessionStream();
  const select = useSubagentStore((state) => state.setActiveSubagentId);
  const outgoing = data.senderSessionId === data.transcriptSessionId;
  const incoming = data.recipientSessionId === data.transcriptSessionId;
  const participantId = outgoing
    ? data.recipientSessionId
    : incoming
      ? data.senderSessionId
      : undefined;
  const child = participantId
    ? events.find(
        (event) =>
          event.type === 'subagent_update' &&
          event.data.native &&
          event.data.subagentId === participantId,
      )
    : undefined;
  const name = child?.type === 'subagent_update' ? child.data.name : participantId;
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
            {child && sessionId ? (
              <button
                type="button"
                className="text-accent hover:underline"
                onClick={() =>
                  select(JSON.stringify([sessionId, 'reported', participantId]), sessionId)
                }
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
      {data.content && <StreamingMarkdown content={data.content} />}
    </section>
  );
}
