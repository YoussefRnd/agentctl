import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Menu, PanelRight } from 'lucide-react';

import { EventFeed } from './EventFeed.js';
import { CommandBar } from './CommandBar.js';
import { ApprovalCard } from './cards/ApprovalCard.js';
import { ReviewView, type ReviewFile } from './ReviewView.js';
import { MagicBar } from './MagicBar.js';
import { StatusPane } from './StatusPane.js';
import { useSessionEvents } from '../hooks/useSessionEvents.js';
import { apiClient } from '../lib/api-client.js';
import { ProviderSwitcher } from './ProviderSwitcher.js';
import { Sidebar } from './Sidebar.js';
import type { SessionWithCapabilities } from '@agentctl/shared';

type WorkbenchTab = 'status' | 'changes';

interface ReviewResponse {
  files: ReviewFile[];
}

type SessionResponse = SessionWithCapabilities;

const getErrorMessage = (error: unknown) => error instanceof Error ? error.message : 'Unexpected error';

const fetchReview = async (sessionId: string): Promise<ReviewResponse> => {
  return apiClient.fetch<ReviewResponse>(`/api/sessions/${sessionId}/review`);
};

const fetchSession = async (sessionId: string): Promise<SessionResponse> => {
  return apiClient.fetch<SessionResponse>(`/api/sessions/${sessionId}`);
};

export function SessionWorkspace({ sessionId }: { sessionId: string }) {
  const [workbenchTab, setWorkbenchTab] = useState<WorkbenchTab>('status');
  const [isWorkbenchOpen, setIsWorkbenchOpen] = useState(true);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
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

  // Toggle with Cmd/Ctrl + \
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === '\\') {
        e.preventDefault();
        setIsWorkbenchOpen(prev => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => { window.removeEventListener('keydown', handleKeyDown); };
  }, []);

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
  const feedErrorMessage = eventsError ? getErrorMessage(eventsError) : null;

  return (
    <div className="flex h-full w-full overflow-hidden relative">
      <div className="hidden lg:block w-[260px] shrink-0 border-r border-border/50 z-20 bg-background">
        <Sidebar />
      </div>

      {/* Mobile Sidebar Overlay */}
      <aside 
        className={`fixed inset-y-0 left-0 w-[280px] bg-background z-50 border-r border-border transition-transform duration-300 ease-in-out lg:hidden ${
          isMobileSidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="h-full flex flex-col">
          <Sidebar />
        </div>
      </aside>

      {/* Mobile Sidebar Backdrop */}
      {isMobileSidebarOpen && (
        <div 
          className="fixed inset-0 bg-background/60 backdrop-blur-sm z-40 lg:hidden"
          onClick={() => { setIsMobileSidebarOpen(false); }}
        />
      )}

      {/* Main Content Area */}
      <main className="flex flex-col flex-1 min-h-0 min-w-0 overflow-hidden relative">
        <header className="border-b border-border flex flex-col px-6 py-2 shrink-0 sm:h-12 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4 min-w-0">
            <button
              type="button"
              className="lg:hidden p-1.5 -ml-2 text-text-muted hover:text-text-main hover:bg-surface rounded-md transition-colors"
              onClick={() => { setIsMobileSidebarOpen(true); }}
              aria-label="Open Sidebar"
            >
              <Menu className="w-5 h-5" />
            </button>
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

          <div className="flex items-center">
            <button
              onClick={() => { setIsWorkbenchOpen(prev => !prev); }}
              className={`p-1.5 rounded-md transition-colors ${
                isWorkbenchOpen ? 'bg-accent/10 text-accent' : 'text-text-muted hover:text-text-main hover:bg-surface'
              }`}
              title="Toggle Workbench (Cmd/Ctrl + \)"
              aria-label="Toggle Workbench"
            >
              <PanelRight className="w-4 h-4" />
            </button>
          </div>
        </header>

        <div className="relative flex-1 min-h-0 overflow-hidden">
          <div className="flex h-full min-h-0 flex-col">
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
        </div>

        <div className="shrink-0 z-10 bg-gradient-to-t from-background via-background to-transparent pt-8">
          <div className="max-w-4xl mx-auto px-4">
            {showApproval && (
              <div className="mb-4">
                <ApprovalCard
                  eventId={lastEvent.id}
                  data={lastEvent.data as { message?: string } | null}
                  onApprove={handleApprove}
                  onDeny={handleDeny}
                />
              </div>
            )}
            
            <MagicBar 
              files={review.files} 
              onAction={(action) => { handleSend(action); }} 
              isReviewOpen={isWorkbenchOpen && workbenchTab === 'changes'}
              onOpenReview={() => {
                setIsWorkbenchOpen(true);
                setWorkbenchTab('changes');
              }}
            />
            
            <div className="mb-6">
              <CommandBar 
                onSend={handleSend} 
                disabled={!isConnected} 
                selectedHarnessId={sessionData?.session.agent}
              />
            </div>
          </div>
        </div>
      </main>

      <aside 
        className={`shrink-0 overflow-hidden bg-surface/90 backdrop-blur-xl transition-[width,transform,opacity,border-color] duration-300 ease-in-out will-change-[width,transform] absolute lg:relative right-0 h-full z-30 shadow-2xl lg:shadow-none border-l ${
          isWorkbenchOpen 
            ? 'w-[85vw] sm:w-[360px] lg:w-[40%] translate-x-0 opacity-100 border-border' 
            : 'w-[85vw] sm:w-[360px] lg:w-0 translate-x-full lg:translate-x-0 opacity-0 lg:opacity-100 border-transparent'
        }`}
      >
        <div className="w-[85vw] sm:w-[360px] lg:w-[40vw] h-full flex flex-col bg-background/50">
          <div className="flex items-center p-2 border-b border-border bg-surface">
            <button
              className={`flex-1 py-1.5 text-[11px] font-bold uppercase tracking-[0.1em] transition-colors rounded-md ${
                workbenchTab === 'status' ? 'bg-background text-text-main shadow-sm' : 'text-text-muted hover:bg-background/50 hover:text-text-main'
              }`}
              onClick={() => { setWorkbenchTab('status'); }}
            >
              Agent Status
            </button>
            <button
              className={`flex-1 py-1.5 text-[11px] font-bold uppercase tracking-[0.1em] transition-colors rounded-md ${
                workbenchTab === 'changes' ? 'bg-background text-text-main shadow-sm' : 'text-text-muted hover:bg-background/50 hover:text-text-main'
              }`}
              onClick={() => { setWorkbenchTab('changes'); }}
            >
              Code Changes
            </button>
          </div>
          <div className="flex-1 min-h-0 overflow-hidden">
            {workbenchTab === 'status' ? (
              <StatusPane events={events} files={review.files} />
            ) : (
              <ReviewView files={review.files} isLoading={isLoadingReview} error={reviewError} onRetry={() => { void refetchReview(); }} />
            )}
          </div>
        </div>
      </aside>
      
      {/* Mobile Backdrop */}
      {isWorkbenchOpen && (
        <div 
          className="absolute inset-0 bg-background/50 backdrop-blur-sm z-20 lg:hidden"
          onClick={() => { setIsWorkbenchOpen(false); }}
        />
      )}
    </div>
  );
}
