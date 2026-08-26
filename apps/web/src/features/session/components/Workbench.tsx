import { useEffect, Suspense, lazy } from 'react';
import { StatusPane } from './StatusPane';
import { useSession } from '../../../contexts/SessionContext';
import { GlassPanel, Badge, Spinner } from '@agentctl/ui';
import { Maximize2, Minimize2, Terminal, FileCode, Activity } from 'lucide-react';

const ReviewView = lazy(() => import('./ReviewView').then((m) => ({ default: m.ReviewView })));
const InteractiveTerminal = lazy(() =>
  import('./workbench/InteractiveTerminal').then((m) => ({ default: m.InteractiveTerminal })),
);

export type WorkbenchTab = 'status' | 'changes' | 'terminal';

interface WorkbenchProps {
  isOpen: boolean;
  tab: WorkbenchTab;
  onTabChange: (tab: WorkbenchTab) => void;
  isMaximized?: boolean;
  onToggleMaximize?: () => void;
}

export function Workbench({
  isOpen: _isOpen,
  tab,
  onTabChange,
  isMaximized,
  onToggleMaximize,
}: WorkbenchProps) {
  const { reviewData, refetchReview } = useSession();

  useEffect(() => {
    if (tab === 'changes') {
      refetchReview();
    }
  }, [tab, refetchReview]);

  const changesCount = reviewData.files.filter((f) => f.state !== 'committed').length;

  return (
    <div className="flex h-full min-w-0 flex-col">
      <GlassPanel
        intensity="high"
        className="h-full overflow-hidden rounded-lg border-none shadow-2xl"
      >
        <div className="flex h-full min-w-0 flex-col">
          {/* Clean 3-Tab Navigation: Status | Changes | Terminal */}
          <div className="border-border/20 bg-surface-secondary/10 flex h-12 shrink-0 items-center justify-between border-b px-2">
            <div className="flex flex-1 items-center gap-1">
              {(['status', 'changes', 'terminal'] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  role="tab"
                  aria-selected={tab === t}
                  className={`relative flex h-8 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-md text-xs font-medium transition-colors duration-200 ${
                    tab === t
                      ? 'text-accent'
                      : 'text-text-muted/60 hover:text-text-muted hover:bg-surface-tertiary/20'
                  }`}
                  onClick={() => {
                    onTabChange(t);
                  }}
                >
                  <span className="relative z-10 flex items-center gap-1">
                    {t === 'status' && <Activity className="h-3 w-3 opacity-80" />}
                    {t === 'changes' && <FileCode className="h-3 w-3 opacity-80" />}
                    {t === 'terminal' && <Terminal className="h-3 w-3 opacity-80" />}
                    {t === 'status' ? 'Status' : t === 'changes' ? 'Changes' : 'Terminal'}
                  </span>
                  {t === 'changes' && changesCount > 0 && (
                    <Badge
                      variant="accent"
                      size="sm"
                      className="relative z-10 font-bold tabular-nums"
                    >
                      {changesCount}
                    </Badge>
                  )}
                  {tab === t && (
                    <div className="bg-surface-accent ring-accent/20 absolute inset-0 rounded-md ring-1" />
                  )}
                </button>
              ))}
            </div>

            {onToggleMaximize && (
              <button
                type="button"
                onClick={onToggleMaximize}
                className="text-text-muted/60 hover:text-accent hover:bg-surface-tertiary/20 ml-2 flex h-7 w-7 items-center justify-center rounded-md transition-colors"
                title={isMaximized ? 'Contract panel' : 'Maximize panel'}
                aria-label={isMaximized ? 'Contract panel' : 'Maximize panel'}
              >
                {isMaximized ? (
                  <Minimize2 className="h-3.5 w-3.5" />
                ) : (
                  <Maximize2 className="h-3.5 w-3.5" />
                )}
              </button>
            )}
          </div>

          <div className="bg-surface-secondary/5 min-h-0 flex-1 overflow-hidden" role="tabpanel">
            <Suspense
              fallback={
                <div className="flex h-full items-center justify-center p-8">
                  <Spinner className="h-5 w-5" />
                </div>
              }
            >
              {tab === 'status' && <StatusPane />}
              {tab === 'changes' && <ReviewView />}
              {tab === 'terminal' && <InteractiveTerminal />}
            </Suspense>
          </div>
        </div>
      </GlassPanel>
    </div>
  );
}
