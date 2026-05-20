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
      className={`bg-surface/90 absolute right-0 z-30 h-full shrink-0 overflow-hidden border-l shadow-2xl backdrop-blur-xl transition-[width,transform,opacity,border-color] duration-300 ease-in-out will-change-[width,transform] lg:relative lg:shadow-none ${
        isOpen
          ? 'border-border w-[85vw] translate-x-0 opacity-100 sm:w-[360px] lg:w-[40%]'
          : 'w-[85vw] translate-x-full border-transparent opacity-0 sm:w-[360px] lg:w-0 lg:translate-x-0 lg:opacity-100'
      }`}
    >
      <div className="bg-background/50 flex h-full w-[85vw] flex-col sm:w-[360px] lg:w-[40vw]">
        <div className="border-border bg-surface flex items-center border-b p-2">
          <button
            className={`flex-1 rounded-md py-1.5 text-[11px] font-bold tracking-[0.1em] uppercase transition-colors ${
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
            className={`flex-1 rounded-md py-1.5 text-[11px] font-bold tracking-[0.1em] uppercase transition-colors ${
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
        <div className="min-h-0 flex-1 overflow-hidden">
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
