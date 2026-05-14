import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Circle } from 'lucide-react';

import { EventFeed } from './EventFeed.js';
import { CommandBar } from './CommandBar.js';
import { ApprovalCard } from './cards/ApprovalCard.js';
import { ReviewView, type ReviewFile } from './ReviewView.js';
import { useSessionEvents } from '../hooks/useSessionEvents.js';
import { apiClient } from '../lib/api-client.js';
import { ProviderSwitcher } from './ProviderSwitcher.js';
import type { SessionWithCapabilities } from '@agentctl/shared/src/schemas.js';

type WorkspaceTab = 'feed' | 'review';

interface ReviewResponse {
  files: ReviewFile[];
}

type SessionResponse = SessionWithCapabilities;

const tabClassName = (active: boolean) =>
  `inline-flex items-center gap-2 rounded-full px-3 py-1.5 transition-colors ${active ? 'bg-accent text-background' : 'text-text-muted hover:text-text-main'}`;

const getErrorMessage = (error: unknown) => error instanceof Error ? error.message : 'Unexpected error';

const fetchReview = async (sessionId: string): Promise<ReviewResponse> => {
  return apiClient.fetch<ReviewResponse>(`/api/sessions/${sessionId}/review`);
};

const fetchSession = async (sessionId: string): Promise<SessionResponse> => {
  return apiClient.fetch<SessionResponse>(`/api/sessions/${sessionId}`);
};

export function SessionWorkspace({ sessionId }: { sessionId: string }) {
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('feed');
  const feedTabRef = useRef<HTMLButtonElement>(null);
  const reviewTabRef = useRef<HTMLButtonElement>(null);
  const { events, isLoading: isLoadingEvents, error: eventsError, refetch: refetchEvents, sendMessage, isConnected } = useSessionEvents(sessionId);
  const { data: sessionData = null } = useQuery({
    queryKey: ['session', sessionId],
    queryFn: () => fetchSession(sessionId),
    enabled: !!sessionId,
  });
  const { data: review = { files: [] }, isLoading: isLoadingReview, error: reviewError, refetch: refetchReview } = useQuery({
    queryKey: ['session-review', sessionId],
    queryFn: () => fetchReview(sessionId),
    enabled: !!sessionId,
  });

  useEffect(() => {
    if (!sessionId) setActiveTab('feed');
  }, [sessionId]);

  useEffect(() => {
    if (activeTab === 'feed') {
      feedTabRef.current?.focus();
    } else {
      reviewTabRef.current?.focus();
    }
  }, [activeTab]);

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
  const hasDirtyChanges = review.files.some((file) => file.state !== 'committed');
  const feedErrorMessage = eventsError ? getErrorMessage(eventsError) : null;

  return (
    <div className="flex-1 flex min-h-0 min-w-0 flex-col overflow-hidden relative">
      <header className="border-b border-border flex flex-col gap-3 px-4 py-3 bg-surface/30 backdrop-blur-sm shrink-0 sm:h-14 sm:flex-row sm:items-center sm:justify-between sm:px-6 sm:py-0 sm:gap-4">
        <div className="flex flex-wrap items-center gap-2 text-sm font-medium min-w-0">
          <span className="text-text-muted">Session:</span>
          <span className="font-mono break-all">{sessionId}</span>
          <span className="px-2 py-0.5 bg-success/20 text-success text-[10px] uppercase font-bold rounded-full tracking-wider">Live</span>
        </div>
        <ProviderSwitcher sessionId={sessionId} data={sessionData} />
        <div
          role="tablist"
          aria-label="Workspace tabs"
          className="inline-flex flex-wrap items-center gap-1 rounded-full border border-border bg-background/40 p-1 text-sm"
          onKeyDown={(event) => {
            if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight' && event.key !== 'Home' && event.key !== 'End') {
              return;
            }

            event.preventDefault();
            const nextTab = event.key === 'Home'
              ? 'feed'
              : event.key === 'End'
                ? 'review'
                : activeTab === 'feed'
                  ? 'review'
                  : 'feed';

            setActiveTab(nextTab);
          }}
        >
          {([
            { key: 'feed' as const, label: 'Feed', ref: feedTabRef },
            { key: 'review' as const, label: 'Review', ref: reviewTabRef },
          ]).map((tab) => (
            <button
              key={tab.key}
              ref={tab.ref}
              type="button"
              role="tab"
              id={`workspace-tab-${tab.key}`}
              aria-selected={activeTab === tab.key}
              aria-controls={`workspace-panel-${tab.key}`}
              tabIndex={activeTab === tab.key ? 0 : -1}
              onClick={() => { setActiveTab(tab.key); }}
              className={tabClassName(activeTab === tab.key)}
            >
              {tab.label}
              {tab.key === 'review' && (
                <Circle data-testid="review-badge-dot" className={`h-2 w-2 ${hasDirtyChanges ? 'fill-danger text-danger' : 'hidden'}`} />
              )}
            </button>
          ))}
        </div>
      </header>

      <div className="relative flex-1 min-h-0 overflow-hidden">
        <div
          id="workspace-panel-feed"
          role="tabpanel"
          aria-labelledby="workspace-tab-feed"
          className={activeTab === 'feed' ? 'flex h-full min-h-0 flex-col' : 'hidden h-full min-h-0 flex-col'}
        >
          <div className="flex-1 min-h-0 overflow-hidden pb-36 sm:pb-48">
            {feedErrorMessage ? (
              <div className="p-4 sm:p-8">
                <div className="rounded-lg border border-danger/30 bg-danger/10 p-4 text-sm">
                  <div className="font-medium text-danger">Failed to load session history</div>
                  <div className="mt-1 text-text-muted">{feedErrorMessage}</div>
                  <button
                    type="button"
                    onClick={() => { void refetchEvents(); }}
                    className="mt-4 rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-main transition-colors hover:bg-background"
                  >
                    Retry
                  </button>
                </div>
              </div>
            ) : isLoadingEvents ? <div className="p-4 sm:p-8 text-center text-text-muted">Loading history...</div> : <EventFeed events={events} />}
          </div>
        </div>
        <div
          id="workspace-panel-review"
          role="tabpanel"
          aria-labelledby="workspace-tab-review"
          className={activeTab === 'review' ? 'flex h-full min-h-0 flex-col' : 'hidden h-full min-h-0 flex-col'}
        >
          <ReviewView files={review.files} isLoading={isLoadingReview} error={reviewError} onRetry={() => { void refetchReview(); }} />
        </div>
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
