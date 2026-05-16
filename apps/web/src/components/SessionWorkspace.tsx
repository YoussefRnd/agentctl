import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { History, FileCode } from 'lucide-react';

import { EventFeed } from './EventFeed.js';
import { CommandBar } from './CommandBar.js';
import { ApprovalCard } from './cards/ApprovalCard.js';
import { ReviewView, type ReviewFile } from './ReviewView.js';
import { useSessionEvents } from '../hooks/useSessionEvents.js';
import { apiClient } from '../lib/api-client.js';
import { ProviderSwitcher } from './ProviderSwitcher.js';
import type { SessionWithCapabilities } from '@agentctl/shared';

type WorkspaceTab = 'feed' | 'review';

interface ReviewResponse {
  files: ReviewFile[];
}

type SessionResponse = SessionWithCapabilities;

const tabClassName = (active: boolean) =>
  `flex items-center gap-2 px-4 py-1.5 text-[13px] font-medium transition-all relative ${
    active ? 'text-accent' : 'text-text-muted hover:text-text-main'
  }`;

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
    enabled: !!sessionId && activeTab === 'review',
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
    <div className="flex-1 flex min-h-0 min-w-0 flex-col overflow-hidden relative bg-background">
      <header className="border-b border-border flex flex-col px-6 py-2 shrink-0 sm:h-12 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4 min-w-0">
          <div className="flex items-center gap-2 text-[13px]">
            <span className="font-mono text-text-muted">{sessionId.slice(0, 8)}</span>
            <span className="flex items-center gap-1.5 px-2 py-0.5 bg-success/10 text-success text-[10px] font-bold rounded-md tracking-wider">
              <span className="w-1.5 h-1.5 bg-success rounded-full animate-pulse" />
              LIVE
            </span>
          </div>
          <div className="h-4 w-px bg-border hidden sm:block" />
          <ProviderSwitcher sessionId={sessionId} data={sessionData} />
        </div>

        <div
          role="tablist"
          aria-label="Workspace tabs"
          className="flex items-center"
          onKeyDown={(event) => {
            if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight' && event.key !== 'Home' && event.key !== 'End') {
              return;
            }
            event.preventDefault();
            const nextTab = event.key === 'Home' ? 'feed' : event.key === 'End' ? 'review' : activeTab === 'feed' ? 'review' : 'feed';
            setActiveTab(nextTab);
          }}
        >
          {[
            { key: 'feed' as const, label: 'Activity', icon: History, ref: feedTabRef },
            { key: 'review' as const, label: 'Changes', icon: FileCode, ref: reviewTabRef },
          ].map((tab) => (
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
              <tab.icon className="w-4 h-4" />
              {tab.label}
              {tab.key === 'review' && hasDirtyChanges && (
                <span className="absolute top-1 right-2 w-1.5 h-1.5 bg-danger rounded-full shadow-[0_0_8px_rgba(239,68,68,0.5)]" />
              )}
              {activeTab === tab.key && (
                <div className="absolute bottom-[-9px] left-0 right-0 h-0.5 bg-accent rounded-full" />
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
          <div className="flex-1 min-h-0 overflow-hidden pb-44 sm:pb-56">
            {feedErrorMessage ? (
              <div className="p-8 max-w-lg mx-auto text-center text-accent">
                <div className="rounded-2xl border border-accent/20 bg-accent/5 p-6">
                  <div className="text-sm font-semibold mb-2 uppercase tracking-widest">Protocol Sync Failed</div>
                  <div className="text-[13px] text-text-muted mb-6">{feedErrorMessage}</div>
                  <button
                    type="button"
                    onClick={() => { void refetchEvents(); }}
                    className="w-full rounded-xl bg-accent text-background px-4 py-2.5 text-sm font-bold hover:bg-accent-hover transition-colors shadow-lg"
                  >
                    Resynchronize
                  </button>
                </div>
              </div>
            ) : isLoadingEvents ? (
              <div className="flex items-center justify-center h-full">
                <div className="flex flex-col items-center gap-4">
                  <div className="w-10 h-10 border-2 border-accent/30 border-t-accent rounded-full animate-spin" />
                  <span className="text-[10px] text-accent/60 font-black tracking-[0.2em] uppercase">Fetching Turn History</span>
                </div>
              </div>
            ) : (
              <EventFeed events={events} />
            )}
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

      <div className="absolute bottom-0 left-0 right-0 z-10 pointer-events-none">
        <div className="max-w-3xl mx-auto px-4 pointer-events-auto">
          {showApproval && (
            <div className="mb-6">
              <ApprovalCard
                eventId={lastEvent.id}
                data={lastEvent.data as { message?: string } | null}
                onApprove={handleApprove}
                onDeny={handleDeny}
              />
            </div>
          )}
        </div>
        <div className="pointer-events-auto">
          <CommandBar 
            onSend={handleSend} 
            disabled={!isConnected} 
            selectedHarnessId={sessionData?.session.agent}
          />
        </div>
      </div>
    </div>
  );
}
