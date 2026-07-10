import { StatusPane } from './StatusPane';
import { ReviewView } from './ReviewView';
import { WorktreesPane } from './WorktreesPane';
import { useSession } from '../../../contexts/SessionContext';
import { GlassPanel } from '@agentctl/ui';

export type WorkbenchTab = 'status' | 'changes' | 'worktrees';

interface WorkbenchProps {
  isOpen: boolean;
  tab: WorkbenchTab;
  onTabChange: (tab: WorkbenchTab) => void;
}

export function Workbench({ isOpen: _isOpen, tab, onTabChange }: WorkbenchProps) {
  const { reviewData } = useSession();

  const changesCount = reviewData.files.filter((f) => f.state !== 'committed').length;

  return (
    <div className="flex h-full min-w-0 flex-col">
      <GlassPanel
        intensity="high"
        className="h-full overflow-hidden rounded-lg border-none shadow-2xl"
      >
        <div className="flex h-full min-w-0 flex-col">
          {/* Enhanced Tab Navigation */}
          <div className="border-border/20 bg-surface-secondary/10 flex h-10 shrink-0 items-center gap-1 border-b px-2">
            {(['status', 'changes', 'worktrees'] as const).map((t) => (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={tab === t}
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

          <div className="bg-surface-secondary/5 min-h-0 flex-1 overflow-hidden" role="tabpanel">
            {tab === 'status' && <StatusPane />}
            {tab === 'worktrees' && <WorktreesPane />}
            {tab === 'changes' && <ReviewView />}
          </div>
        </div>
      </GlassPanel>
    </div>
  );
}
