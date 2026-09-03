import { useEffect, Suspense, lazy } from 'react';
import { StatusPane } from './StatusPane';
import { useSession } from '../../../contexts/SessionContext';
import { GlassPanel, Badge, Spinner } from '@agentctl/ui';
import { Maximize2, Minimize2, Terminal, FileText } from 'lucide-react';
import { DiffIcon } from '@primer/octicons-react';

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
          {/* Clean 3-Tab Segmented Control: Status | Changes | Terminal */}
          <div className="border-border/20 bg-surface-secondary/10 flex h-12 shrink-0 items-center justify-between border-b px-2">
            <div className="bg-surface-secondary/30 relative flex flex-1 items-center rounded-lg p-0.5">
              {/* Sliding active tab indicator pill */}
              <div
                className="bg-surface-accent ring-accent/20 pointer-events-none absolute inset-y-0.5 rounded-md ring-1 transition-transform duration-200 ease-[cubic-bezier(0.23,1,0.32,1)]"
                style={{
                  width: 'calc((100% - 4px) / 3)',
                  transform: `translateX(calc(${(['status', 'changes', 'terminal'] as const).indexOf(tab) * 100}% + ${(['status', 'changes', 'terminal'] as const).indexOf(tab) * 2}px))`,
                }}
              />

              {(['status', 'changes', 'terminal'] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  role="tab"
                  aria-selected={tab === t}
                  className={`relative z-10 flex h-7.5 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-md text-xs font-medium transition-colors duration-150 active:scale-[0.97] ${
                    tab === t
                      ? 'text-accent font-semibold'
                      : 'text-text-muted/70 hover:text-text-main'
                  }`}
                  onClick={() => {
                    onTabChange(t);
                  }}
                >
                  <span className="flex items-center gap-1.5">
                    {t === 'status' && <FileText className="h-3.5 w-3.5 opacity-80" />}
                    {t === 'changes' && <DiffIcon className="h-3.5 w-3.5 opacity-80" />}
                    {t === 'terminal' && <Terminal className="h-3.5 w-3.5 opacity-80" />}
                    {t === 'status' ? 'Status' : t === 'changes' ? 'Changes' : 'Terminal'}
                  </span>
                  {t === 'changes' && changesCount > 0 && (
                    <Badge variant="accent" size="sm" className="font-bold tabular-nums">
                      {changesCount}
                    </Badge>
                  )}
                </button>
              ))}
            </div>

            {onToggleMaximize && (
              <button
                type="button"
                onClick={onToggleMaximize}
                className="text-text-muted/60 hover:text-accent hover:bg-surface-tertiary/20 ml-2 flex h-7 w-7 cursor-pointer items-center justify-center rounded-md transition-[color,background-color] duration-150 active:scale-[0.97]"
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
