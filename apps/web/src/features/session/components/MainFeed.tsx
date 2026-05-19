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
      <div className="relative flex-1 min-h-0 overflow-hidden">
        <div className="flex h-full min-h-0 flex-col">
          <div className="flex-1 min-h-0 overflow-hidden pb-44 sm:pb-56">
            {isLoadingEvents ? (
              <div className="flex items-center justify-center h-full">
                <div className="flex flex-col items-center gap-4">
                  <div className="w-10 h-10 border-2 border-accent/30 border-t-accent rounded-full animate-spin" />
                  <span className="text-[10px] text-accent/60 font-black tracking-[0.2em] uppercase">
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

      <div className="shrink-0 z-10 bg-gradient-to-t from-background via-background to-transparent pt-8">
        <div className="max-w-4xl mx-auto px-4">
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
