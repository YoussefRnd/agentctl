import { useState, useRef, useEffect, Suspense, lazy } from 'react';
import { StatusPane } from './StatusPane';
import { useSession } from '@/features/sessions';
import { GlassPanel, Spinner, Dropdown, cn } from '@agentctl/ui';
import { Maximize2, Minimize2, Terminal, FileText, X, Plus, Layout } from 'lucide-react';
import { DiffIcon } from '@primer/octicons-react';
import { useWorkbenchStore, type WorkbenchTab } from '../model/useWorkbenchStore';

const ReviewView = lazy(() =>
  import('@/features/review/ui/ReviewView').then((module) => ({ default: module.ReviewView })),
);
const InteractiveTerminal = lazy(() =>
  import('./terminal/InteractiveTerminal').then((module) => ({
    default: module.InteractiveTerminal,
  })),
);

export type { WorkbenchTab };

interface TabDefinition {
  id: WorkbenchTab;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  description: string;
}

const ALL_TABS: TabDefinition[] = [
  {
    id: 'changes',
    label: 'Changes',
    icon: DiffIcon,
    description: 'File diffs, review & git actions',
  },
  {
    id: 'terminal',
    label: 'Terminal',
    icon: Terminal,
    description: 'Interactive session shell',
  },
  {
    id: 'status',
    label: 'Status',
    icon: FileText,
    description: 'Model info & session configuration',
  },
];

interface WorkbenchProps {
  isOpen: boolean;
  tab: WorkbenchTab | null;
  openTabs?: WorkbenchTab[];
  onTabChange: (tab: WorkbenchTab) => void;
  onOpenTab?: (tab: WorkbenchTab) => void;
  onCloseTab?: (tab: WorkbenchTab) => void;
  onMoveTab?: (fromIndex: number, toIndex: number) => void;
  isMaximized?: boolean;
  onToggleMaximize?: () => void;
}

export function Workbench({
  isOpen: _isOpen,
  tab,
  openTabs,
  onTabChange,
  onOpenTab,
  onCloseTab,
  onMoveTab,
  isMaximized,
  onToggleMaximize,
}: WorkbenchProps) {
  const { reviewData, refetchReview } = useSession();

  const storeOpenTabs = useWorkbenchStore((s) => s.openWorkbenchTabs);
  const storeOpenTab = useWorkbenchStore((s) => s.openWorkbenchTab);
  const storeCloseTab = useWorkbenchStore((s) => s.closeWorkbenchTab);
  const storeMoveTab = useWorkbenchStore((s) => s.moveWorkbenchTab);

  const tabs = openTabs ?? storeOpenTabs;
  const handleTabChange = onTabChange;
  const handleOpenTab = onOpenTab ?? storeOpenTab;
  const handleCloseTab = onCloseTab ?? storeCloseTab;
  const handleMoveTab = onMoveTab ?? storeMoveTab;

  const draggedTabRef = useRef<WorkbenchTab | null>(null);
  const [draggedTab, setDraggedTab] = useState<WorkbenchTab | null>(null);

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
          {/* Dynamic Tab Bar Header: Tabs | [+] | Maximize */}
          <div className="border-border/20 bg-surface-secondary/10 flex h-10 shrink-0 items-center justify-between gap-1 border-b px-2">
            <div className="flex min-w-0 flex-1 [scrollbar-width:none] items-center gap-1 overflow-x-auto">
              {tabs.map((t, idx) => {
                const isActive = tab === t;
                const tabMeta = ALL_TABS.find((item) => item.id === t);
                const Icon = tabMeta?.icon ?? FileText;
                const label = tabMeta?.label ?? t;
                const isDragged = draggedTab === t;

                return (
                  <div
                    key={t}
                    role="tab"
                    tabIndex={0}
                    aria-selected={isActive}
                    draggable={true}
                    onDragStart={(e) => {
                      e.dataTransfer.setData('text/plain', t);
                      e.dataTransfer.effectAllowed = 'move';
                      draggedTabRef.current = t;
                      setDraggedTab(t);
                    }}
                    onDragEnter={(e) => {
                      e.preventDefault();
                      const source = draggedTabRef.current;
                      if (source && source !== t) {
                        const fromIdx = tabs.indexOf(source);
                        const toIdx = tabs.indexOf(t);
                        if (fromIdx !== -1 && toIdx !== -1 && fromIdx !== toIdx) {
                          handleMoveTab(fromIdx, toIdx);
                        }
                      }
                    }}
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.dataTransfer.dropEffect = 'move';
                      const source = draggedTabRef.current;
                      if (source && source !== t) {
                        const fromIdx = tabs.indexOf(source);
                        const toIdx = tabs.indexOf(t);
                        if (fromIdx !== -1 && toIdx !== -1 && fromIdx !== toIdx) {
                          handleMoveTab(fromIdx, toIdx);
                        }
                      }
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      draggedTabRef.current = null;
                      setDraggedTab(null);
                    }}
                    onDragEnd={() => {
                      draggedTabRef.current = null;
                      setDraggedTab(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        handleTabChange(t);
                      } else if ((e.altKey || e.metaKey) && e.key === 'ArrowLeft' && idx > 0) {
                        e.preventDefault();
                        handleMoveTab(idx, idx - 1);
                      } else if (
                        (e.altKey || e.metaKey) &&
                        e.key === 'ArrowRight' &&
                        idx < tabs.length - 1
                      ) {
                        e.preventDefault();
                        handleMoveTab(idx, idx + 1);
                      }
                    }}
                    onClick={() => handleTabChange(t)}
                    onMouseDown={(e) => {
                      if (e.button === 1) {
                        e.preventDefault();
                        handleCloseTab(t);
                      }
                    }}
                    className={cn(
                      'group relative flex h-7.5 shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border px-3 text-xs font-medium transition-[background-color,border-color,color,opacity] duration-150',
                      isActive
                        ? 'text-text-main border-border/40 bg-surface/60 shadow-xs'
                        : 'text-text-muted hover:text-text-main hover:border-border/20 hover:bg-surface/30 border-transparent',
                      isDragged && 'opacity-40',
                    )}
                  >
                    <Icon
                      className={cn(
                        'h-3.5 w-3.5 shrink-0 transition-opacity',
                        isActive
                          ? 'text-text-main opacity-90'
                          : 'text-text-muted opacity-70 group-hover:opacity-90',
                      )}
                    />
                    <span
                      className={
                        isActive
                          ? 'text-text-main font-medium'
                          : 'text-text-muted group-hover:text-text-main'
                      }
                    >
                      {label}
                    </span>

                    {t === 'changes' && changesCount > 0 && (
                      <span
                        className={cn(
                          'py-0.2 ml-0.5 inline-flex items-center justify-center rounded-full px-1.5 text-[10px] font-semibold tabular-nums',
                          isActive
                            ? 'text-text-main bg-accent/20 text-accent'
                            : 'bg-surface-secondary text-text-muted group-hover:text-text-main',
                        )}
                      >
                        {changesCount}
                      </span>
                    )}

                    {/* Quiet hover-only close button */}
                    <button
                      type="button"
                      aria-label={`Close ${label} tab`}
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleCloseTab(t);
                      }}
                      className="text-text-muted hover:text-text-main hover:bg-surface-secondary -mr-1.5 ml-0.5 flex h-4 w-4 cursor-pointer items-center justify-center rounded opacity-0 transition-[opacity,background-color] duration-150 group-hover:opacity-80 hover:!opacity-100"
                      title="Close tab"
                    >
                      <X className="h-2.5 w-2.5" />
                    </button>
                  </div>
                );
              })}

              {/* Plus Button Dropdown to Add / Reopen Tabs */}
              <Dropdown.Root>
                <Dropdown.Trigger asChild>
                  <button
                    type="button"
                    className="motion-disclosure text-text-muted/70 hover:text-text-main data-[state=open]:bg-accent/10 data-[state=open]:text-accent flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-lg hover:bg-white/[0.06]"
                    title="Add panel tab"
                    aria-label="Add panel tab"
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                </Dropdown.Trigger>
                <Dropdown.Portal>
                  <Dropdown.Content align="start" className="w-60">
                    <div className="text-role-eyebrow text-text-muted/60 px-2.5 py-1.5">
                      Open Panel
                    </div>
                    {ALL_TABS.map((item) => {
                      const Icon = item.icon;
                      const isOpen = tabs.includes(item.id);
                      return (
                        <Dropdown.Item
                          key={item.id}
                          className="hover:bg-surface-secondary flex cursor-pointer items-center justify-between gap-3 rounded-lg px-2.5 py-2 text-xs transition-colors"
                          onSelect={() => handleOpenTab(item.id)}
                        >
                          <div className="flex min-w-0 items-center gap-2.5">
                            <Icon className="text-accent icon-compact shrink-0" />
                            <div className="min-w-0">
                              <p className="text-text-main leading-tight font-medium">
                                {item.label}
                              </p>
                              <p className="text-text-muted/70 truncate text-[10px] leading-tight">
                                {item.description}
                              </p>
                            </div>
                          </div>
                          {isOpen && (
                            <span className="text-accent/80 bg-accent/10 shrink-0 rounded px-1.5 py-0.5 text-[9px] font-semibold tracking-wider uppercase">
                              Open
                            </span>
                          )}
                        </Dropdown.Item>
                      );
                    })}
                  </Dropdown.Content>
                </Dropdown.Portal>
              </Dropdown.Root>
            </div>

            {/* Right: Maximize / Contract */}
            {onToggleMaximize && (
              <button
                type="button"
                onClick={onToggleMaximize}
                className="motion-disclosure text-text-muted/60 hover:text-text-main hover:bg-surface-secondary ml-1 flex h-7 w-7 cursor-pointer items-center justify-center rounded-lg transition-colors"
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
            {tabs.length === 0 || tab === null ? (
              <div className="flex h-full flex-col items-center justify-center overflow-y-auto p-6 text-center select-none">
                <div className="flex w-full max-w-sm flex-col items-center gap-4">
                  <div className="border-border/30 bg-surface/40 text-accent flex h-11 w-11 items-center justify-center rounded-2xl border shadow-sm">
                    <Layout className="icon-prominent" />
                  </div>
                  <div className="space-y-1">
                    <h3 className="text-role-title text-text-main">No open panels</h3>
                    <p className="text-role-body text-text-muted text-xs">
                      Select a workspace tool below or click{' '}
                      <span className="text-text-main/80 font-mono">+</span> in the tab bar.
                    </p>
                  </div>

                  <div className="grid w-full grid-cols-1 gap-2 pt-1 text-left">
                    {ALL_TABS.map((item) => {
                      const Icon = item.icon;
                      const isChanges = item.id === 'changes';
                      const hasChanges = isChanges && changesCount > 0;

                      return (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => handleOpenTab(item.id)}
                          className="motion-disclosure border-border/30 bg-surface/30 hover:border-accent/40 hover:bg-surface/60 group relative flex cursor-pointer items-center justify-between rounded-xl border p-3 text-left transition-colors"
                        >
                          <div className="flex min-w-0 items-center gap-3">
                            <div className="border-border/20 bg-surface-secondary/60 text-accent group-hover:border-accent/30 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border transition-colors">
                              <Icon className="icon-compact" />
                            </div>
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="text-role-control text-text-main font-semibold">
                                  {item.label}
                                </span>
                                {hasChanges && (
                                  <span className="bg-accent/15 text-accent border-accent/30 py-0.2 rounded-full border px-1.5 text-[10px] font-bold tabular-nums">
                                    {changesCount} changed
                                  </span>
                                )}
                              </div>
                              <p className="text-role-caption text-text-muted mt-0.5 truncate">
                                {item.description}
                              </p>
                            </div>
                          </div>
                          <span className="text-text-muted/40 group-hover:text-text-main ml-2 shrink-0 text-xs transition-colors">
                            →
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            ) : (
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
            )}
          </div>
        </div>
      </GlassPanel>
    </div>
  );
}
