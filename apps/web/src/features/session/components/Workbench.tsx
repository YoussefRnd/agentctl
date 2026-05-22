import { StatusPane } from './StatusPane';
import { ReviewView } from './ReviewView';
import { useSession } from '../../../contexts/SessionContext';
import { PanelRight } from 'lucide-react';

export type WorkbenchTab = 'status' | 'changes';

interface WorkbenchProps {
  isOpen: boolean;
  tab: WorkbenchTab;
  onTabChange: (tab: WorkbenchTab) => void;
  onToggle: () => void;
}

export function Workbench({ isOpen, tab, onTabChange, onToggle }: WorkbenchProps) {
  const { reviewData, isLoadingReview } = useSession();

  return (
    <aside
      className={`terminal-glass absolute right-0 z-30 h-full shrink-0 overflow-hidden border-l transition-[width,transform,opacity,border-color] duration-300 ease-in-out will-change-[width,transform] lg:relative ${
        isOpen
          ? 'w-[85vw] translate-x-0 opacity-100 sm:w-[320px] lg:w-[35%]'
          : 'w-[85vw] translate-x-full opacity-0 sm:w-[320px] lg:w-[44px] lg:translate-x-0 lg:opacity-100'
      }`}
    >
      <div className="flex h-full flex-col min-w-[320px] lg:min-w-0">
        <div className="border-border flex shrink-0 h-11 items-center border-b p-1 gap-1 bg-surface-secondary">
          <div className={`flex flex-1 gap-1 h-full transition-opacity duration-200 ${isOpen ? 'opacity-100' : 'opacity-0 lg:hidden'}`}>
            <button
              className={`flex-1 text-[9px] font-display font-extrabold tracking-widest uppercase transition-colors rounded-sm ${
                tab === 'status'
                  ? 'bg-text-main text-background'
                  : 'text-text-muted hover:text-text-main hover:bg-white/5'
              }`}
              onClick={() => {
                onTabChange('status');
              }}
            >
              STATUS
            </button>
            <button
              className={`flex-1 text-[9px] font-display font-extrabold tracking-widest uppercase transition-colors rounded-sm ${
                tab === 'changes'
                  ? 'bg-text-main text-background'
                  : 'text-text-muted hover:text-text-main hover:bg-white/5'
              }`}
              onClick={() => {
                onTabChange('changes');
              }}
            >
              CHANGES
            </button>
          </div>
          <button
            onClick={onToggle}
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-sm transition-all ${
              isOpen ? 'text-text-main hover:bg-white/10' : 'text-text-muted hover:text-text-main hover:bg-white/5'
            }`}
            title="Toggle Inspector"
          >
            <PanelRight className="h-4 w-4" />
          </button>
        </div>
        <div className={`min-h-0 flex-1 overflow-hidden transition-opacity duration-200 ${isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
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


