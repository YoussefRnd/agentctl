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
  const { reviewData, isLoadingReview } = useSession();

  return (
    <aside
      className={`shrink-0 overflow-hidden bg-surface/90 backdrop-blur-xl transition-[width,transform,opacity,border-color] duration-300 ease-in-out will-change-[width,transform] absolute lg:relative right-0 h-full z-30 shadow-2xl lg:shadow-none border-l ${
        isOpen
          ? 'w-[85vw] sm:w-[360px] lg:w-[40%] translate-x-0 opacity-100 border-border'
          : 'w-[85vw] sm:w-[360px] lg:w-0 translate-x-full lg:translate-x-0 opacity-0 lg:opacity-100 border-transparent'
      }`}
    >
      <div className="w-[85vw] sm:w-[360px] lg:w-[40vw] h-full flex flex-col bg-background/50">
        <div className="flex items-center p-2 border-b border-border bg-surface">
          <button
            className={`flex-1 py-1.5 text-[11px] font-bold uppercase tracking-[0.1em] transition-colors rounded-md ${
              tab === 'status'
                ? 'bg-background text-text-main shadow-sm'
                : 'text-text-muted hover:bg-background/50 hover:text-text-main'
            }`}
            onClick={() => {
              onTabChange('status');
            }}
          >
            Agent Status
          </button>
          <button
            className={`flex-1 py-1.5 text-[11px] font-bold uppercase tracking-[0.1em] transition-colors rounded-md ${
              tab === 'changes'
                ? 'bg-background text-text-main shadow-sm'
                : 'text-text-muted hover:bg-background/50 hover:text-text-main'
            }`}
            onClick={() => {
              onTabChange('changes');
            }}
          >
            Code Changes
          </button>
        </div>
        <div className="flex-1 min-h-0 overflow-hidden">
          {tab === 'status' ? (
            <StatusPane files={reviewData.files} />
          ) : (
            <ReviewView
              files={reviewData.files}
              isLoading={isLoadingReview}
              onRetry={() => {
                // void refetchReview();
              }}
            />
          )}
        </div>
      </div>
    </aside>
  );
}
