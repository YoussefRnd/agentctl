import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Clock } from 'lucide-react';
import { StreamingMarkdown, UnifiedActivityBlock } from '@/features/conversation';
import { formatDuration, type SubagentGroup } from '../lib/subagentBlockUtils';
import type {
  SessionEventSubagentUpdateData,
  SessionEventRow,
  SessionEventToolCallData,
} from '@agentctl/shared';

interface SubagentChatViewProps {
  group: SubagentGroup;
  onBack: () => void;
  isStreaming?: boolean;
}

export function SubagentChatView({ group, onBack, isStreaming = false }: SubagentChatViewProps) {
  const [now, setNow] = useState<Date>(() => new Date());

  const data = group.subagentEvent.data as SessionEventSubagentUpdateData;
  const childEvents = group.childEvents;
  const isRunning = data.status === 'running' || data.status === 'spawning';

  useEffect(() => {
    if (!isRunning) return;
    const id = setInterval(() => {
      setNow(new Date());
    }, 250);
    return () => clearInterval(id);
  }, [isRunning]);

  // Handle escape key to go back
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onBack();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onBack]);

  const startDate =
    childEvents.length > 0 ? childEvents[0].createdAt : group.subagentEvent.createdAt;
  const endDate =
    !isRunning && childEvents.length > 0 ? childEvents[childEvents.length - 1].createdAt : null;
  const duration = formatDuration(startDate, now, endDate);

  // Extract thoughts, tool calls, and text response from childEvents
  const { activityEvents, responseText } = useMemo(() => {
    const activities: SessionEventRow[] = [];
    let text = data.result?.summary ?? '';

    for (const e of childEvents) {
      if (
        (e.type === 'text' && (e.data as { role?: string }).role === 'thought') ||
        e.type === 'tool_call' ||
        e.type === 'approval_request'
      ) {
        activities.push(e);
      } else if (
        e.type === 'text' &&
        ((e.data as { role?: string }).role === 'provider' ||
          (e.data as { role?: string }).role === 'assistant')
      ) {
        const content = (e.data as { content?: string }).content;
        if (content) {
          text = text ? `${text}\n${content}` : content;
        }
      }
    }

    if (!text && childEvents.length > 0) {
      const lastChild = childEvents[childEvents.length - 1];
      if (lastChild.type === 'tool_call') {
        const tc = lastChild.data as SessionEventToolCallData;
        if (typeof tc.rawOutput === 'string' && tc.rawOutput) {
          text = tc.rawOutput;
        }
      }
    }

    return { activityEvents: activities, responseText: text };
  }, [childEvents, data.result?.summary]);

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-transparent">
      {/* Top Header Bar with Back Button */}
      <header className="border-border/20 bg-surface-secondary/20 flex shrink-0 items-center justify-between border-b px-6 py-3 backdrop-blur-md">
        <div className="flex items-center">
          <button
            type="button"
            onClick={onBack}
            className="text-text-muted hover:text-text-main hover:bg-surface-secondary/60 flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            <span>Back to session</span>
          </button>
        </div>

        <div className="text-text-muted/60 flex items-center gap-1.5 font-mono text-xs tabular-nums">
          <Clock className="h-3.5 w-3.5" />
          <span>{duration}</span>
        </div>
      </header>

      {/* Main Conversation Feed (no chat box) */}
      <main className="min-h-0 flex-1 [scrollbar-width:thin] overflow-y-auto px-6 py-6">
        <div className="mx-auto max-w-[800px] space-y-6">
          {/* What the parent agent told the subagent (rendered like user prompt in main chat) */}
          {data.scope && (
            <div className="flex justify-end">
              <div className="border-border bg-surface-secondary text-text-main max-w-[85%] rounded-2xl border px-4 py-3 text-[14px] leading-relaxed shadow-sm sm:max-w-[75%]">
                <div className="text-text-muted/50 mb-1 text-[10px] font-bold tracking-wider uppercase select-none">
                  Task prompt
                </div>
                <div className="whitespace-pre-wrap">{data.scope}</div>
              </div>
            </div>
          )}

          {/* Subagent's Response and Activity (rendered like main chat) */}
          <div className="space-y-4">
            {(activityEvents.length > 0 || isRunning) && (
              <UnifiedActivityBlock
                events={activityEvents}
                isStreaming={isStreaming && isRunning}
                isActive={isRunning}
                isInitialThinking={activityEvents.length === 0 && isRunning}
              />
            )}

            {responseText && (
              <div className="prose prose-invert prose-pre:bg-surface-secondary/50 prose-pre:border prose-pre:border-border prose-pre:rounded-md text-text-main/90 selection:bg-accent/30 max-w-none text-[15px] leading-7 tracking-normal">
                <StreamingMarkdown content={responseText} isStreaming={isStreaming && isRunning} />
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
