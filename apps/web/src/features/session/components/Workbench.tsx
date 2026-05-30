import { StatusPane } from './StatusPane';
import { ReviewView } from './ReviewView';
import { useSession } from '../../../contexts/SessionContext';

export type WorkbenchTab = 'status' | 'changes';

interface WorkbenchProps {
  isOpen: boolean;
  tab: WorkbenchTab;
  onTabChange: (tab: WorkbenchTab) => void;
}

export function Workbench({ isOpen, tab, onTabChange }: WorkbenchProps) {
  const { reviewData, isLoadingReview, stageFile, revertFile, refetchReview } = useSession();

  return (
    <aside
      className={`terminal-glass border-border cubic-bezier(0.16, 1, 0.3, 1) bg-surface/30 h-full shrink-0 overflow-hidden rounded-3xl border shadow-2xl transition-[width,opacity] duration-500 will-change-[width] ${
        isOpen ? 'w-[320px] opacity-100 lg:w-[480px]' : 'w-0 border-none opacity-0'
      }`}
    >
      <div className="flex h-full min-w-[320px] flex-col">
        {' '}
        <div className="border-border bg-surface-secondary/50 flex h-11 shrink-0 items-center gap-1 border-b p-1 backdrop-blur-md">
          <div className="flex h-full flex-1 gap-1 px-1">
            <button
              className={`flex-1 rounded-md text-[9px] font-extrabold tracking-widest uppercase transition-all duration-300 ${
                tab === 'status'
                  ? 'bg-text-main text-background shadow-[0_0_15px_rgba(205,214,244,0.2)]'
                  : 'text-text-muted hover:text-text-main hover:bg-surface-tertiary/40'
              }`}
              onClick={() => {
                onTabChange('status');
              }}
            >
              STATUS
            </button>
            <button
              className={`flex-1 rounded-md text-[9px] font-extrabold tracking-widest uppercase transition-all duration-300 ${
                tab === 'changes'
                  ? 'bg-text-main text-background shadow-[0_0_15px_rgba(205,214,244,0.2)]'
                  : 'text-text-muted hover:text-text-main hover:bg-surface-tertiary/40'
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
            />
          )}
        </div>
      </div>
    </aside>
  );
}
