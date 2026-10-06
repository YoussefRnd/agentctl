import { CommandResultCard } from './cards/CommandResultCard';
import { ElicitationCard } from './cards/ElicitationCard';
import { AgentResponse } from './cards/AgentResponse';
import { TextCard } from './cards/TextCard';
import { TurnErrorCard } from './cards/TurnErrorCard';
import type { FeedEventGroup } from '../lib/eventFeedGrouping';
import type { ElicitationItem } from '@agentctl/shared';
import type { RewindMode } from '@/features/sessions';

interface EventFeedItemProps {
  group: FeedEventGroup;
  latestAgentGroupId: string | null;
  sessionId?: string;
  hasGitRepo?: boolean;
  isConnected?: boolean;
  onRewind?: (eventId: number, mode: RewindMode) => void;
  onEditSubmit?: (eventId: number, newContent: string) => void;
  onRetryMessage?: (eventId: number) => void;
}

export function EventFeedItem({
  group,
  latestAgentGroupId,
  sessionId,
  hasGitRepo,
  isConnected,
  onRewind,
  onEditSubmit,
  onRetryMessage,
}: EventFeedItemProps) {
  if (group.type === 'error') {
    const message = group.event.type === 'status' ? group.event.data.message : undefined;
    return <TurnErrorCard message={typeof message === 'string' ? message : undefined} />;
  }
  if (group.type === 'notice') {
    const data = group.event.data as { title?: string };
    return (
      <p
        role="status"
        className="my-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-300"
      >
        {data.title}
      </p>
    );
  }

  if (group.type === 'command') {
    const data = group.event.data as {
      command?: string;
      args?: Record<string, unknown>;
      commandStatus?: string;
    };
    return (
      <div className="my-2 [contain-intrinsic-size:auto_100px] [content-visibility:auto]">
        <CommandResultCard
          command={data.command ?? 'unknown'}
          args={data.args}
          status={data.commandStatus}
          isStreaming={group.isStreaming}
        />
      </div>
    );
  }

  if (group.type === 'elicitation') {
    const data = group.event.data as {
      elicitation?: ElicitationItem;
    };
    if (!data.elicitation) return null;
    return (
      <div className="my-2 [contain-intrinsic-size:auto_100px] [content-visibility:auto]">
        <ElicitationCard
          elicitation={data.elicitation}
          onRespond={async (id, resp) => {
            if (!sessionId) return;
            const response = await fetch(`/api/sessions/${sessionId}/elicitations/${id}/respond`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(resp),
            });
            if (!response.ok) {
              const data: unknown = await response.json().catch(() => null);
              const message =
                data &&
                typeof data === 'object' &&
                'message' in data &&
                typeof data.message === 'string'
                  ? data.message
                  : 'Could not submit the response. Try again.';
              throw new Error(message);
            }
          }}
        />
      </div>
    );
  }

  if (group.type === 'agent') {
    return (
      <div className="my-2 [contain-intrinsic-size:auto_100px] [content-visibility:auto]">
        <AgentResponse
          events={group.events}
          isStreaming={group.isStreaming}
          isActive={group.id === latestAgentGroupId}
          isConnected={isConnected}
        />
      </div>
    );
  }

  const { event: e, isStreaming } = group;
  return (
    <div className="my-2 [contain-intrinsic-size:auto_100px] [content-visibility:auto]">
      <TextCard
        content={(e.data as { content: string }).content}
        variant="user"
        isStreaming={isStreaming}
        eventId={e.id}
        deliveryStatus={e.type === 'text' ? e.data.deliveryStatus : undefined}
        deliveryError={e.type === 'text' ? e.data.deliveryError : undefined}
        onRetry={onRetryMessage}
        hasGitRepo={hasGitRepo}
        onRewind={onRewind}
        onEditSubmit={onEditSubmit}
        attachments={
          (
            e.data as {
              attachments?: {
                attachmentId: string;
                mimeType: string;
                filename: string;
                sizeBytes: number;
              }[];
            }
          ).attachments
        }
      />
    </div>
  );
}
