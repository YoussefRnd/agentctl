import { EventFeed } from './EventFeed';
import { MagicBar } from './MagicBar';
import { CommandBar } from './CommandBar';
import { ApprovalCard } from './cards/ApprovalCard';
import { useSession } from '../../../contexts/SessionContext';
import { useSessionActions } from '../../../hooks/useSessionActions';
import { useDrivers } from '../../../hooks/useDrivers';
import type { WorkbenchTab } from './Workbench';

interface MainFeedProps {
  isWorkbenchOpen: boolean;
  workbenchTab: WorkbenchTab;
  onOpenWorkbench: (tab: WorkbenchTab) => void;
}

export function MainFeed({ isWorkbenchOpen, workbenchTab, onOpenWorkbench }: MainFeedProps) {
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

  return (
    <>
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <div className="flex h-full min-h-0 flex-col">
          <div className="min-h-0 flex-1 overflow-hidden pb-44 sm:pb-56">
            {isLoadingEvents ? (
              <div className="flex h-full items-center justify-center">
                <div className="flex flex-col items-center gap-4">
                  <div className="border-accent/30 border-t-accent h-10 w-10 animate-spin rounded-full border-2" />
                  <span className="text-accent/60 text-[10px] font-black tracking-[0.2em] uppercase">
                    Fetching Turn History
                  </span>
                </div>
              </div>
            ) : (
              <EventFeed events={events} />
            )}
          </div>
        </div>
      </div>

      <div className="from-background via-background z-10 shrink-0 bg-gradient-to-t to-transparent pt-8">
        <div className="mx-auto max-w-4xl px-4">
          {events.length > 0 && lastEvent.type === 'approval_request' && (
            <div className="mb-4">
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
            isReviewOpen={isWorkbenchOpen && workbenchTab === 'changes'}
            onOpenReview={() => {
              onOpenWorkbench('changes');
            }}
          />

          <div className="mb-6">
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
