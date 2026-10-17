import { useEffect, useId, useMemo, useRef } from 'react';
import { ArrowLeft, ChevronRight } from 'lucide-react';
import {
  StreamingMarkdown,
  ActivityBlock,
  AgentTerminals,
  TranscriptMessage,
  sessionMessageParticipant,
} from '@/shared/transcript';
import {
  formatSubagentTitle,
  getSubagentGroupKey,
  isSubagentActive,
  subagentDisplayStatus,
  subagentResult,
  subagentApprovals,
  type SubagentGroup,
} from '../lib/subagentBlockUtils';
import { SubagentElapsed } from './SubagentElapsed';
import { SubagentStatus } from './SubagentStatus';
import { SubagentDisclosure } from './SubagentDisclosure';
import type { SessionEventRow, SessionEventSubagentUpdateData } from '@agentctl/shared';

interface SubagentChatViewProps {
  group: SubagentGroup;
  groups?: SubagentGroup[];
  parentTitle?: string;
  onSelect?: (group: SubagentGroup) => void;
  onBack: () => void;
  isStreaming?: boolean;
  isConnected?: boolean;
  showThinking?: boolean;
  onReviewApproval?: () => void;
}

// Keep each run of tools/thoughts together without moving it past the next response.
function transcriptEntries(events: SessionEventRow[]): SessionEventRow[][] {
  const entries: SessionEventRow[][] = [];
  let activity: SessionEventRow[] = [];
  for (const event of events) {
    if (
      event.type === 'tool_call' ||
      event.type === 'approval_request' ||
      (event.type === 'text' && event.data.role === 'thought')
    ) {
      activity.push(event);
    } else if (event.type === 'text') {
      if (activity.length) entries.push(activity);
      activity = [];
      entries.push([event]);
    }
  }
  if (activity.length) entries.push(activity);
  return entries;
}

/** A read-only child conversation: control and approval stay with the parent. */
export function SubagentChatView({
  group,
  groups,
  parentTitle = 'Parent conversation',
  onSelect,
  onBack,
  isStreaming = false,
  isConnected = true,
  showThinking = false,
  onReviewApproval,
}: SubagentChatViewProps) {
  const backRef = useRef<HTMLButtonElement>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const followingRef = useRef(true);
  const selectorId = useId();
  const key = getSubagentGroupKey(group);
  useEffect(() => {
    backRef.current?.focus();
  }, []);

  const data = group.subagentEvent.data as SessionEventSubagentUpdateData;
  const active = !data.historical && isSubagentActive(data.status) && isConnected;
  useEffect(() => {
    followingRef.current = true;
  }, [key]);
  useEffect(() => {
    const transcript = transcriptRef.current;
    const content = contentRef.current;
    if (!transcript || !content || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      if (active && followingRef.current) transcript.scrollTop = transcript.scrollHeight;
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, [key, active]);
  const response = subagentResult(group);
  const entries = useMemo(() => transcriptEntries(group.childEvents), [group.childEvents]);
  const transcriptResponse = group.childEvents
    .filter(
      (event) =>
        event.type === 'text' &&
        (event.data.role === 'provider' || (event.data.role as string) === 'assistant'),
    )
    .map((event) => (event.data as { content: string }).content)
    .filter(Boolean);
  const showResult =
    response &&
    response !== [...new Set(transcriptResponse)].join('\n\n') &&
    !transcriptResponse.includes(response);
  const hasChildActivity =
    entries.length > 0 || group.childEvents.some((event) => event.type.startsWith('terminal_'));
  const error = data.native && data.state?.stopReason === 'error' ? data.state.error : null;
  const errorMessage =
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof error.message === 'string'
      ? error.message
      : null;

  return (
    <section
      aria-label="Subagent conversation"
      className="bg-surface flex h-full min-w-0 flex-1 flex-col overflow-hidden"
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !event.defaultPrevented) {
          event.preventDefault();
          onBack();
        }
      }}
    >
      <header className="border-border/40 flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-3 sm:px-5">
        <nav
          aria-label="Conversation breadcrumb"
          className="flex min-w-0 flex-1 items-center gap-2 text-xs"
        >
          <button
            ref={backRef}
            type="button"
            onClick={onBack}
            aria-label="Back to parent conversation"
            className="text-text-muted hover:text-text-main focus-visible:ring-accent/50 flex min-w-0 items-center gap-2 rounded-md px-2 py-1.5 focus-visible:ring-2 focus-visible:outline-none"
          >
            <ArrowLeft aria-hidden className="h-3.5 w-3.5 shrink-0" />
            <span className="max-w-40 truncate">{parentTitle}</span>
          </button>
          <ChevronRight aria-hidden className="text-text-muted/50 h-3 w-3 shrink-0" />
          <span className="text-text-main truncate" aria-current="page">
            {formatSubagentTitle(data.name)}
          </span>
        </nav>
        {groups && groups.length > 1 && onSelect && (
          <>
            <label htmlFor={selectorId} className="sr-only">
              Switch task
            </label>
            <select
              id={selectorId}
              value={key}
              onChange={(event) => {
                const next = groups.find(
                  (item) => getSubagentGroupKey(item) === event.target.value,
                );
                if (next) onSelect(next);
              }}
              className="bg-surface-secondary/50 text-text-muted focus-visible:ring-accent/50 max-w-[min(15rem,100%)] min-w-0 rounded-md px-2 py-1.5 text-xs focus-visible:ring-2 focus-visible:outline-none"
            >
              {groups.map((item) => (
                <option key={getSubagentGroupKey(item)} value={getSubagentGroupKey(item)}>
                  {formatSubagentTitle(
                    (item.subagentEvent.data as SessionEventSubagentUpdateData).name,
                  )}{' '}
                  · {subagentDisplayStatus(item, isConnected)}
                </option>
              ))}
            </select>
          </>
        )}
      </header>
      <div
        key={key}
        ref={transcriptRef}
        onScroll={(event) => {
          const element = event.currentTarget;
          followingRef.current =
            element.scrollTop + element.clientHeight >= element.scrollHeight - 40;
        }}
        className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain"
        tabIndex={0}
        aria-label="Subagent transcript"
      >
        <div
          ref={contentRef}
          className="mx-auto w-full max-w-[800px] space-y-6 px-4 py-7 [overflow-wrap:anywhere] sm:px-8"
        >
          <div>
            <p className="text-text-muted mb-2 text-xs">Subagent</p>
            <h2 className="text-text-main text-lg font-semibold">
              {formatSubagentTitle(data.name)}
            </h2>
            <div className="mt-2 flex flex-wrap items-center gap-3" role="status">
              <SubagentStatus group={group} isConnected={isConnected} />
              <SubagentElapsed group={group} isConnected={isConnected} />
            </div>
          </div>
          {data.scope && (
            <SubagentDisclosure title="Original assignment" label="Task prompt">
              <p className="text-text-muted text-sm leading-relaxed whitespace-pre-wrap">
                {data.scope}
              </p>
            </SubagentDisclosure>
          )}
          {subagentApprovals(group).length > 0 && (
            <div
              className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-400"
              role="status"
            >
              <p>This task needs approval to continue.</p>
              <button
                type="button"
                onClick={onReviewApproval ?? onBack}
                className="mt-2 rounded-md border border-amber-500/40 px-3 py-1.5 focus-visible:outline focus-visible:outline-2"
              >
                Review approval in chat
              </button>
            </div>
          )}
          {entries.map((events, index) => {
            const first = events[0];
            const streaming = isStreaming && active && index === entries.length - 1;
            if (first.type === 'text' && first.data.role === 'session') {
              const participantId = sessionMessageParticipant(first.data);
              const participant = groups?.find(
                (candidate) =>
                  candidate.subagentEvent.type === 'subagent_update' &&
                  candidate.subagentEvent.data.native &&
                  candidate.subagentEvent.data.subagentId === participantId,
              );
              const name =
                participant?.subagentEvent.type === 'subagent_update'
                  ? participant.subagentEvent.data.name
                  : undefined;
              return (
                <TranscriptMessage
                  key={first.id}
                  data={first.data}
                  participantName={name}
                  onSelectParticipant={
                    participant && onSelect ? () => onSelect(participant) : undefined
                  }
                />
              );
            }
            if (first.type === 'text' && first.data.role !== 'thought') {
              return (
                <section
                  key={first.id}
                  aria-label={first.data.role === 'user' ? 'Child message' : 'Subagent response'}
                  className="text-text-main prose prose-invert max-w-none text-sm leading-relaxed [&_pre]:max-w-full [&_pre]:overflow-x-auto"
                >
                  <StreamingMarkdown content={first.data.content} isStreaming={streaming} />
                </section>
              );
            }
            return (
              <ActivityBlock
                key={first.id}
                events={events}
                isStreaming={streaming}
                isCompleted={!(active && index === entries.length - 1)}
                showThinking={showThinking}
              />
            );
          })}
          <AgentTerminals events={group.childEvents} />
          {errorMessage &&
            errorMessage !== response &&
            !transcriptResponse.includes(errorMessage) && (
              <p role="alert" className="text-sm text-rose-400">
                {errorMessage}
              </p>
            )}
          {(showResult || transcriptResponse.length === 0) && (
            <section aria-label="Result">
              <h3 className="text-text-muted mb-3 text-xs font-medium">
                {active
                  ? 'Latest response'
                  : data.status === 'failed'
                    ? 'Error / result'
                    : 'Result'}
              </h3>
              {response ? (
                <div className="text-text-main prose prose-invert max-w-none text-sm leading-relaxed [&_pre]:max-w-full [&_pre]:overflow-x-auto">
                  <StreamingMarkdown content={response} isStreaming={isStreaming && active} />
                </div>
              ) : (
                <p className="text-text-muted text-sm">
                  {active ? 'Waiting for a reported response…' : 'No result was reported.'}
                </p>
              )}
            </section>
          )}
          {!hasChildActivity && (
            <SubagentDisclosure
              title="Reported activity"
              initiallyOpen={active && !response}
              hint="Details unavailable"
            >
              <p className="text-text-muted mb-3 text-xs">
                No child activity was reported. Only the delegation record is available.
              </p>
              {!!group.delegationEvents?.length && (
                <ActivityBlock
                  events={group.delegationEvents}
                  isStreaming={isStreaming && active}
                  isCompleted={!active}
                  showThinking={showThinking}
                />
              )}
            </SubagentDisclosure>
          )}
        </div>
      </div>
      <footer className="border-border/30 text-text-muted flex shrink-0 flex-wrap items-center justify-between gap-2 border-t px-4 py-3 text-xs sm:px-6">
        <span>Read-only · Continue this task in the parent conversation.</span>
        <button
          type="button"
          onClick={onBack}
          className="text-text-main hover:text-accent focus-visible:ring-accent/50 rounded-md px-2 py-1 focus-visible:ring-2 focus-visible:outline-none"
        >
          Back to parent
        </button>
      </footer>
    </section>
  );
}
