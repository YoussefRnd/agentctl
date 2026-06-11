import { StatusPane } from './StatusPane';
import { ReviewView } from './ReviewView';
import { useSession } from '../../../contexts/SessionContext';
import { GlassPanel } from '@agentctl/ui';

export type WorkbenchTab = 'status' | 'changes';

interface WorkbenchProps {
  isOpen: boolean;
  tab: WorkbenchTab;
  onTabChange: (tab: WorkbenchTab) => void;
}

export function Workbench({ isOpen, tab, onTabChange }: WorkbenchProps) {
  const {
    reviewData,
    isLoadingReview,
    stageFile,
    revertFile,
    refetchReview,
    sessionData,
    mergeSession,
    isMergingSession,
    discardSession,
    isDiscardingSession,
  } = useSession();

  return (
    <aside
      className={`ease-[cubic-bezier(0.16,1,0.3,1)] h-full shrink-0 overflow-hidden transition-[width,opacity] duration-500 will-change-[width] ${
        isOpen ? 'w-[320px] opacity-100 lg:w-[480px]' : 'w-0 opacity-0'
      }`}
    >
      <GlassPanel intensity="high" className="h-full border-none shadow-2xl rounded-3xl overflow-hidden">
        <div className="flex h-full min-w-[320px] flex-col">
          <div className="border-border/50 bg-surface-secondary/30 flex h-12 shrink-0 items-center gap-1 border-b p-1.5 backdrop-blur-md">
            <div className="flex h-full flex-1 gap-1.5">
              <button
                className={`flex-1 rounded-xl text-[9px] font-bold tracking-widest uppercase transition-all duration-300 border cursor-pointer ${
                  tab === 'status'
                    ? 'bg-accent/15 text-accent border-accent/25 shadow-[0_0_15px_rgba(203,166,247,0.1)]'
                    : 'text-text-muted hover:text-text-main hover:bg-white/5 border-transparent'
                }`}
                onClick={() => {
                  onTabChange('status');
                }}
              >
                STATUS
              </button>
              <button
                className={`flex-1 rounded-xl text-[9px] font-bold tracking-widest uppercase transition-all duration-300 border cursor-pointer ${
                  tab === 'changes'
                    ? 'bg-accent/15 text-accent border-accent/25 shadow-[0_0_15px_rgba(203,166,247,0.1)]'
                    : 'text-text-muted hover:text-text-main hover:bg-white/5 border-transparent'
                }`}
                onClick={() => {
                  onTabChange('changes');
                }}
              >
                CHANGES
              </button>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-hidden">
            {tab === 'status' ? (
              <StatusPane files={reviewData.files} />
            ) : (
              <ReviewView
                files={reviewData.files}
                isLoading={isLoadingReview}
                onStage={(filePath) => {
                  void stageFile(filePath);
                }}
                onRevert={(filePath) => {
                  void revertFile(filePath);
                }}
                onRetry={() => {
                  refetchReview();
                }}
                sessionStatus={sessionData?.session.status}
                taskSlug={sessionData?.session.taskSlug}
                onMerge={(msg) => {
                  void mergeSession(msg);
                }}
                onDiscard={() => {
                  void discardSession();
                }}
                isMerging={isMergingSession}
                isDiscarding={isDiscardingSession}
              />
            )}
          </div>
        </div>
      </GlassPanel>
    </aside>
  );
}
