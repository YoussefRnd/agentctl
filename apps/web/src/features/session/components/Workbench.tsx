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
   className={`terminal-glass h-full shrink-0 overflow-hidden border border-border shadow-2xl transition-[width,opacity] duration-500 cubic-bezier(0.16, 1, 0.3, 1) will-change-[width] ${
    isOpen
     ? 'w-[320px] lg:w-[480px] opacity-100'
     : 'w-0 opacity-0 border-none'
   }`}
  >
   <div className="flex h-full flex-col min-w-[320px]">
    <div className="border-border flex shrink-0 h-11 items-center border-b p-1 gap-1 bg-surface-secondary/50 backdrop-blur-md">
     <div className="flex flex-1 gap-1 h-full px-1">
      <button
       className={`flex-1 text-[9px] font-extrabold tracking-widest uppercase transition-all duration-300 rounded-sm ${
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
       className={`flex-1 text-[9px] font-extrabold tracking-widest uppercase transition-all duration-300 rounded-sm ${
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
     <button
      onClick={onToggle}
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-sm transition-all text-text-muted hover:text-text-main hover:bg-surface-tertiary/50"
      title="Toggle Inspector"
     >
      <PanelRight className="h-4 w-4" />
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


