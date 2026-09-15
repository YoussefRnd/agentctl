import type { SessionEventRow, SessionEventToolCallData } from '@agentctl/shared';
import { TimelineEvent } from './TimelineEvent';
import { ToolCallCard } from './ToolCallCard';
import { getToolMeta } from '@/shared/lib/toolColors';

interface ActivityTimelineProps {
  events: SessionEventRow[];
  isStreaming?: boolean;
}

export function ActivityTimeline({ events, isStreaming = false }: ActivityTimelineProps) {
  const total = events.length;
  return (
    <div>
      {events.map((e, i) => {
        const isOnly = total === 1;
        const isFirst = i === 0;
        const isLast = i === total - 1;
        const isLastStreaming = isStreaming && isLast;

        const reqData = e.data as {
          name?: string;
          request?: { toolCall?: { name?: string; arguments?: Record<string, unknown> } };
        };
        const toolName = reqData.request?.toolCall?.name ?? reqData.name ?? 'tool';
        const payload = (
          e.type === 'approval_request' ? (reqData.request?.toolCall ?? reqData) : e.data
        ) as SessionEventToolCallData;

        const isFailed = payload.status === 'failed';
        const dynamicDotColor = isFailed
          ? 'bg-rose-500'
          : getToolMeta(payload.kind, toolName).dotColor;

        return (
          <TimelineEvent
            key={e.id}
            dotColor={dynamicDotColor}
            isPulsing={isLastStreaming}
            position={isOnly ? 'only' : isFirst ? 'first' : isLast ? 'last' : 'middle'}
          >
            <ToolCallCard
              tool={toolName}
              payload={payload}
              isStreaming={isLastStreaming}
              durationMs={e.metadata?.durationMs}
            />
          </TimelineEvent>
        );
      })}
    </div>
  );
}
