import { CommandResultCard } from './cards/CommandResultCard';
import { ElicitationCard } from './cards/ElicitationCard';
import { AgentResponse } from './cards/AgentResponse';
import { TextCard } from './cards/TextCard';
import type { FeedEventGroup } from './eventFeedGrouping';
import type { ElicitationItem } from '@agentctl/shared';
import type { RewindMode } from './RewindMenu';

interface EventFeedItemProps {
  group: FeedEventGroup;
  latestAgentGroupId: string | null;
  sessionId?: string;
  hasGitRepo?: boolean;
  onRewind?: (eventId: number, mode: RewindMode) => void;
  onEditSubmit?: (eventId: number, newContent: string) => void;
}

export function EventFeedItem({
  group,
  latestAgentGroupId,
  sessionId,
  hasGitRepo,
  onRewind,
  onEditSubmit,
}: EventFeedItemProps) {
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
          onRespond={(id, resp) => {
            if (!sessionId) return;
            void fetch(`/api/sessions/${sessionId}/elicitations/${id}/respond`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(resp),
            });
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
