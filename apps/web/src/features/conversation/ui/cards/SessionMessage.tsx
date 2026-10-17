import type { SessionEventTextData } from '@agentctl/shared';
import { useSession, useSessionStream } from '@/features/sessions';
import { useSubagentStore } from '@/features/subagents';
import { TranscriptMessage, sessionMessageParticipant } from '@/shared/transcript';

/** Reported communication between ACP sessions, distinct from answers to the user. */
export function SessionMessage({ data }: { data: SessionEventTextData }) {
  const { sessionId } = useSession();
  const { events } = useSessionStream();
  const select = useSubagentStore((state) => state.setActiveSubagentId);
  const participantId = sessionMessageParticipant(data);
  const child = participantId
    ? events.find(
        (event) =>
          event.type === 'subagent_update' &&
          event.data.native &&
          event.data.subagentId === participantId,
      )
    : undefined;
  const name = child?.type === 'subagent_update' ? child.data.name : participantId;
  return (
    <TranscriptMessage
      data={data}
      participantName={name}
      onSelectParticipant={
        child && sessionId
          ? () => select(JSON.stringify([sessionId, 'reported', participantId]), sessionId)
          : undefined
      }
    />
  );
}
