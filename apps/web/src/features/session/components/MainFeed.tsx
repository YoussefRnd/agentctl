import { useState } from 'react';
import { EventFeed } from './EventFeed';
import { MagicBar } from './MagicBar';
import { CommandBar } from './CommandBar';
import { ApprovalCard } from './cards/ApprovalCard';
import { useSession } from '../../../contexts/SessionContext';
import { useSessionActions } from '../../../hooks/useSessionActions';
import { useDrivers } from '../../../hooks/useDrivers';

export function MainFeed() {
  const {
    sessionId,
    sessionData,
    events,
    isLoadingEvents,
    isConnected,
    isLoadingSession,
    reviewData,
  } = useSession();

  const { handleSend, handleApprove, handleDeny } = useSessionActions();
  const { switchProvider, isSwitching } = useDrivers(sessionId);

  const handleHarnessSelect = (driverId: string, modelId?: string) => {
    switchProvider(driverId, modelId, sessionData);
  };

  const lastEvent = events[events.length - 1];

  const loadingMessages = [
    'SCANNING_HISTORY_VECTORS...',
    'RECONCILING_BRANCH_STATES...',
    'HYDRATING_SESSION_CONTEXT...',
    'ESTABLISHING_ACP_HANDSHAKE...',
    'MAPPING_WORKTREE_STRUCTURE...',
    'SYNCING_PROTOCOL_BUFFERS...',
  ];

  const [loadingMsg] = useState(() => loadingMessages[Math.floor(Math.random() * loadingMessages.length)]);

  if (!sessionId) {
    return (
      <div className="flex h-full flex-col bg-black p-8 items-center justify-center text-center">
        <div className="max-w-md w-full space-y-8">
          <div>
            <h1 className="text-white text-3xl font-black uppercase tracking-[0.3em] mb-2">TERMINAL_INITIALIZED</h1>
            <div className="bg-white/5 border border-white/10 p-2 text-[10px] font-black uppercase tracking-widest text-text-muted">
              SYSTEM_STATUS::READY_FOR_ORCHESTRATION
            </div>
          </div>

          <div className="space-y-4 text-left">
            <section className="space-y-2">
              <h3 className="text-white text-[11px] font-black uppercase tracking-widest border-b border-white/5 pb-1">::MANIFESTO</h3>
              <div className="space-y-3">
                <div className="flex gap-3">
                  <span className="text-white font-black text-[11px]">01</span>
                  <p className="text-text-muted text-[11px] font-bold uppercase tracking-tight leading-4">
                    <span className="text-white">ORCHESTRATION::</span> RUN MULTIPLE AI AGENTS IN PARALLEL WITHOUT CONTEXT COLLISION.
                  </p>
                </div>
                <div className="flex gap-3">
                  <span className="text-white font-black text-[11px]">02</span>
                  <p className="text-text-muted text-[11px] font-bold uppercase tracking-tight leading-4">
                    <span className="text-white">ISOLATION::</span> EVERY TASK OPERATES WITHIN A PROTECTED GIT WORKTREE.
                  </p>
                </div>
                <div className="flex gap-3">
                  <span className="text-white font-black text-[11px]">03</span>
                  <p className="text-text-muted text-[11px] font-bold uppercase tracking-tight leading-4">
                    <span className="text-white">PROTOCOL::</span> BUILT ON ACP FOR STANDARDIZED AGENT-CLIENT COMMUNICATION.
                  </p>
                </div>
              </div>
            </section>

            <section className="space-y-2 pt-4">
              <h3 className="text-white text-[11px] font-black uppercase tracking-widest border-b border-white/5 pb-1">::NEXT_STEPS</h3>
              <div className="bg-white/[0.02] border border-white/5 p-3 space-y-2">
                <p className="text-text-muted text-[10px] font-black uppercase tracking-widest">
                  1. SELECT_PROJECT_FROM_SIDEBAR
                </p>
                <p className="text-text-muted text-[10px] font-black uppercase tracking-widest">
                  2. INITIALIZE_NEW_SESSION_CONTEXT
                </p>
              </div>
            </section>
          </div>

          <div className="pt-4">
            <p className="text-text-muted/30 text-[9px] font-black uppercase tracking-[0.2em] animate-pulse">
              AWAITING_INPUT...
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="relative min-h-0 flex-1 overflow-hidden bg-black">
        <div className="flex h-full min-h-0 flex-col">
          <div className="min-h-0 flex-1 overflow-hidden pb-40">
            {isLoadingEvents ? (
              <div className="flex h-full items-center justify-center">
                <div className="flex flex-col items-center gap-2">
                  <div className="h-6 w-6 animate-spin border-2 border-white border-t-transparent" />
                  <span className="text-white text-[10px] font-black uppercase tracking-widest opacity-40">
                    {loadingMsg}
                  </span>
                </div>
              </div>
            ) : (
              <EventFeed events={events} />
            )}
          </div>
        </div>
      </div>

      <div className="z-10 shrink-0 bg-black pt-4 border-t border-white/5">
        <div className="mx-auto max-w-4xl">
          {events.length > 0 && lastEvent.type === 'approval_request' && (
            <div className="px-4 mb-2">
              <ApprovalCard
                eventId={lastEvent.id}
                data={lastEvent.data}
                onApprove={handleApprove}
                onDeny={handleDeny}
              />
            </div>
          )}
          <MagicBar
            files={reviewData.files}
            onAction={(action) => {
              handleSend(action);
            }}
          />

          <div className="mb-4">
            <CommandBar
              onSend={handleSend}
              disabled={!isConnected || isSwitching || isLoadingSession}
              selectedHarnessId={sessionData?.session.selectedDriver}
              selectedModelId={sessionData?.session.selectedModel}
              onHarnessSelect={handleHarnessSelect}
            />
          </div>
        </div>
      </div>
    </>
  );
}
