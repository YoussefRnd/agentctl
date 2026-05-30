import { useState } from 'react';
import type { ACPEventRow } from '@agentctl/shared';
import { EventFeed } from './EventFeed';
import { CommandBar } from './CommandBar';
import { ApprovalCard } from './cards/ApprovalCard';
import { useSession } from '../../../contexts/SessionContext';
import { useSessionActions } from '../../../hooks/useSessionActions';
import { useProviders } from '../../../hooks/useProviders';

export function MainFeed() {
  const { sessionId, sessionData, events, isLoadingEvents, isConnected, isLoadingSession } =
    useSession();

  const { handleSend, handleApprove, handleDeny } = useSessionActions();
  const { switchProvider, isSwitching } = useProviders(sessionId);

  const handleProviderSelect = (providerId: string, modelId?: string) => {
    switchProvider(providerId, modelId, sessionData);
  };

  const lastEvent = events[events.length - 1] as ACPEventRow | undefined;

  const approvalEvent =
    lastEvent?.type === 'approval_request' &&
    (lastEvent.data as { status?: string }).status === 'pending'
      ? lastEvent
      : undefined;

  const loadingMessages = [
    'SCANNING_HISTORY_VECTORS...',
    'RECONCILING_BRANCH_STATES...',
    'HYDRATING_SESSION_CONTEXT...',
    'ESTABLISHING_ACP_HANDSHAKE...',
    'MAPPING_WORKTREE_STRUCTURE...',
    'SYNCING_PROTOCOL_BUFFERS...',
  ];

  const [loadingMsg] = useState(
    () => loadingMessages[Math.floor(Math.random() * loadingMessages.length)],
  );

  if (!sessionId) {
    return (
      <div className="bg-background flex h-full flex-col items-center justify-center p-8 text-center">
        <div className="animate-in fade-in zoom-in w-full max-w-md space-y-8 duration-1000">
          <div className="space-y-4">
            <div className="text-accent/60 inline-block rounded-full border border-white/5 bg-white/5 px-4 py-1 text-[10px] font-black tracking-[0.3em] uppercase">
              System_Standby
            </div>
            <h1 className="text-text-main text-5xl leading-none font-black tracking-tight uppercase">
              Select_A_Workspace
            </h1>
            <p className="text-text-muted/40 text-[11px] leading-relaxed font-bold tracking-widest uppercase">
              Choose a project from the sidebar to initialize a new secure agent session.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-background relative flex h-full flex-col overflow-hidden">
      {/* Refined Grid Background */}
      <div className="absolute inset-0 z-0">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(203,166,247,0.08),transparent_70%)]" />
        <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(255,255,255,0.02)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[size:40px_40px]" />
      </div>

      <div className="relative z-10 flex h-full min-w-0 flex-col">
        <main className="relative flex min-h-0 flex-1 flex-col">
          {isLoadingEvents ? (
            <div className="flex h-full flex-col items-center justify-center gap-4 font-mono">
              <div className="via-accent/40 h-px w-24 animate-pulse bg-gradient-to-r from-transparent to-transparent" />
              <div className="text-accent/60 animate-pulse text-[11px] font-black tracking-[0.3em] uppercase">
                {loadingMsg}
              </div>
              <div className="via-accent/40 h-px w-24 animate-pulse bg-gradient-to-r from-transparent to-transparent" />
            </div>
          ) : (
            <EventFeed events={events} />
          )}
        </main>

        {/* Floating Footer Overlay */}
        <footer className="pointer-events-none shrink-0">
          {approvalEvent && (
            <div className="pointer-events-auto mx-auto max-w-[800px] px-6 pb-6">
              <div className="animate-in slide-in-from-bottom-4 duration-500">
                <ApprovalCard
                  eventId={approvalEvent.id}
                  data={approvalEvent.data}
                  onApprove={handleApprove}
                  onDeny={handleDeny}
                />
              </div>
            </div>
          )}

          <div className="pointer-events-auto">
            <CommandBar
              onSend={handleSend}
              disabled={!isConnected || isSwitching || isLoadingSession}
              selectedProviderId={sessionData?.session.selectedProvider}
              selectedModelId={sessionData?.session.selectedModel}
              onProviderSelect={handleProviderSelect}
            />
          </div>
        </footer>
      </div>
    </div>
  );
}
