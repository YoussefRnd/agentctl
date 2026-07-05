import { StatusPane } from './StatusPane';
import { ReviewView } from './ReviewView';
import { WorktreesPane } from './WorktreesPane';
import { useSession } from '../../../contexts/SessionContext';
import { GlassPanel } from '@agentctl/ui';
import { toast } from 'sonner';

export type WorkbenchTab = 'status' | 'changes' | 'worktrees';

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
    unstageFile,
    stageAll,
    unstageAll,
    commitChanges,
    pushChanges,
    pullChanges,
    isPushing,
    isPulling,
    isCommitting,
    isStagingAll,
    isUnstagingAll,
    refetchReview,
    sessionData,
    mergeSession,
    isMergingSession,
    discardSession,
    isDiscardingSession,
  } = useSession();

  const changesCount = reviewData.files.filter((f) => f.state !== 'committed').length;

  return (
    <aside
      className={`h-full shrink-0 overflow-hidden transition-[width,opacity] duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] will-change-[width] ${
        isOpen ? 'w-[320px] opacity-100 lg:w-[480px]' : 'w-0 opacity-0'
      }`}
    >
      <GlassPanel
        intensity="high"
        className="h-full overflow-hidden rounded-lg border-none shadow-2xl"
      >
        <div className="flex h-full min-w-[320px] flex-col">
          {/* Enhanced Tab Navigation */}
          <div className="border-border/20 bg-surface-secondary/10 flex h-12 shrink-0 items-center border-b px-2">
            {(['status', 'changes', 'worktrees'] as const).map((t) => (
              <button
                key={t}
                type="button"
                className={`relative flex h-8 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-md text-[10px] font-black tracking-[0.15em] uppercase transition-all duration-200 ${
                  tab === t
                    ? 'text-accent'
                    : 'text-text-muted/40 hover:text-text-muted/70 hover:bg-surface-tertiary/20'
                }`}
                onClick={() => {
                  onTabChange(t);
                }}
              >
                <span className="relative z-10">
                  {t === 'status' ? 'Status' : t === 'changes' ? 'Changes' : 'Worktrees'}
                </span>
                {t === 'changes' && changesCount > 0 && (
                  <span className="bg-surface-accent/20 ring-accent/20 relative z-10 flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 ring-1">
                    <span className="text-accent text-[9px] font-black tabular-nums">
                      {changesCount}
                    </span>
                  </span>
                )}
                {tab === t && (
                  <div className="bg-surface-accent ring-accent/20 absolute inset-0 rounded-md ring-1" />
                )}
              </button>
            ))}
          </div>

          <div className="bg-surface-secondary/5 min-h-0 flex-1 overflow-hidden">
            {tab === 'status' && <StatusPane />}
            {tab === 'worktrees' && <WorktreesPane />}
            {tab === 'changes' && (
              <ReviewView
                files={reviewData.files}
                isLoading={isLoadingReview}
                onStage={(filePath) => {
                  void stageFile(filePath);
                }}
                onUnstage={(filePath) => {
                  void unstageFile(filePath);
                }}
                onRevert={(filePath) => {
                  void revertFile(filePath);
                }}
                onRetry={() => {
                  refetchReview();
                }}
                sessionStatus={sessionData?.session.status}
                taskSlug={sessionData?.session.taskSlug}
                sessionMode={sessionData?.session.mode}
                onMerge={(msg) => {
                  void mergeSession(msg);
                }}
                onDiscard={() => {
                  void discardSession();
                }}
                isMerging={isMergingSession}
                isDiscarding={isDiscardingSession}
                onStageAll={() => {
                  void stageAll();
                }}
                onUnstageAll={() => {
                  void unstageAll();
                }}
                onCommitChanges={(msg) => {
                  void commitChanges(msg);
                }}
                onPush={() => {
                  pushChanges()
                    .then((res) => {
                      if (res.success) {
                        toast.success('Pushed successfully to remote');
                      } else {
                        toast.error(`Push failed: ${res.output}`);
                      }
                    })
                    .catch((err: unknown) => {
                      const message = err instanceof Error ? err.message : String(err);
                      toast.error(`Push failed: ${message}`);
                    });
                }}
                onPull={() => {
                  pullChanges()
                    .then((res) => {
                      if (res.success) {
                        toast.success('Pulled changes successfully');
                      } else {
                        toast.error(`Pull failed: ${res.output}`);
                      }
                    })
                    .catch((err: unknown) => {
                      const message = err instanceof Error ? err.message : String(err);
                      toast.error(`Pull failed: ${message}`);
                    });
                }}
                isPushing={isPushing}
                isPulling={isPulling}
                isCommitting={isCommitting}
                isStagingAll={isStagingAll}
                isUnstagingAll={isUnstagingAll}
              />
            )}
          </div>
        </div>
      </GlassPanel>
    </aside>
  );
}
