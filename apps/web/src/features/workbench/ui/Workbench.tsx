import { useState, useRef, useEffect, Suspense, lazy } from 'react';
import { StatusPane } from './StatusPane';
import { useSession } from '@/features/sessions';
import { GlassPanel, Spinner, Dropdown, Tooltip, cn } from '@agentctl/ui';
import { Maximize2, Minimize2, Terminal, FileText, X, Plus, Layout } from 'lucide-react';
import { DiffIcon } from '@primer/octicons-react';
import { useWorkbenchStore, type WorkbenchTab } from '../model/useWorkbenchStore';

const ReviewView = lazy(() =>
  import('@/features/review').then((module) => ({ default: module.ReviewView })),
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

const STATIC_TABS: TabDefinition[] = [
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
    description: 'Interactive shells and split terminals',
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
          {/* Unified Workbench Top Header: Tabs | [+] | Maximize */}
          <div className="border-border/20 bg-surface-secondary/15 flex h-9 shrink-0 items-center justify-between gap-1.5 border-b px-2">
            {/* Left: Tab Strip */}
            <div
              className="flex min-w-0 flex-1 [scrollbar-width:none] items-center gap-1 overflow-x-auto py-1"
              role="tablist"
              aria-label="Workbench views"
            >
              {tabs.map((t, idx) => {
                const isActive = tab === t;
                const tabDef = STATIC_TABS.find((def) => def.id === t);
                const Icon = tabDef?.icon ?? FileText;
                const label = tabDef?.label ?? t;
                const isDragged = draggedTab === t;

                return (
                  <div
                    key={t}
                    role="presentation"
                    draggable
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
                    onMouseDown={(e) => {
                      if (e.button === 1) {
                        e.preventDefault();
                        handleCloseTab(t);
                      }
                    }}
                    className={cn(
                      'group relative flex h-7 shrink-0 items-center rounded-md border text-xs font-medium transition-[background-color,border-color,color,opacity] duration-150',
                      isActive
                        ? 'text-text-main border-border/40 bg-surface/80 shadow-xs'
                        : 'text-text-muted hover:text-text-main hover:border-border/20 hover:bg-surface/30 border-transparent',
                      isDragged && 'opacity-40',
                    )}
                  >
                    <button
                      type="button"
                      role="tab"
                      tabIndex={isActive ? 0 : -1}
                      aria-selected={isActive}
                      onClick={() => handleTabChange(t)}
                      onKeyDown={(e) => {
                        if ((e.altKey || e.metaKey) && e.key === 'ArrowLeft' && idx > 0) {
                          e.preventDefault();
                          handleMoveTab(idx, idx - 1);
                        } else if (
                          (e.altKey || e.metaKey) &&
                          e.key === 'ArrowRight' &&
                          idx < tabs.length - 1
                        ) {
                          e.preventDefault();
                          handleMoveTab(idx, idx + 1);
                        } else if (!e.altKey && !e.metaKey && e.key === 'ArrowLeft' && idx > 0) {
                          e.preventDefault();
                          handleTabChange(tabs[idx - 1]!);
                        } else if (
                          !e.altKey &&
                          !e.metaKey &&
                          e.key === 'ArrowRight' &&
                          idx < tabs.length - 1
                        ) {
                          e.preventDefault();
                          handleTabChange(tabs[idx + 1]!);
                        }
                      }}
                      className="focus-visible:ring-accent/40 flex h-full min-w-0 cursor-pointer items-center gap-1.5 rounded-l-md py-0 pr-1 pl-2.5 focus-visible:ring-1 focus-visible:outline-none"
                    >
                      <Icon
                        className={cn(
                          'icon-inline shrink-0 transition-opacity',
                          isActive
                            ? 'text-accent opacity-100'
                            : 'text-text-muted opacity-70 group-hover:opacity-90',
                        )}
                      />
                      <span
                        className={cn(
                          'truncate',
                          isActive
                            ? 'text-text-main font-medium'
                            : 'text-text-muted group-hover:text-text-main',
                        )}
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
                    </button>

                    {/* Close button */}
                    <button
                      type="button"
                      aria-label={`Close ${label} tab`}
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleCloseTab(t);
                      }}
                      className="text-text-muted hover:bg-surface-secondary mr-1 flex h-7 w-7 cursor-pointer items-center justify-center rounded opacity-0 transition-[opacity,background-color] duration-150 group-focus-within:opacity-80 group-hover:opacity-80 hover:text-rose-400 hover:!opacity-100 focus-visible:opacity-100 focus-visible:outline-none"
                      title="Close tab"
                    >
                      <X className="icon-inline" />
                    </button>
                  </div>
                );
              })}

              {/* Plus Button Dropdown to Add / Reopen Tabs */}
              <Dropdown.Root>
                <Dropdown.Trigger asChild>
                  <button
                    type="button"
                    className="motion-disclosure text-text-muted hover:text-text-main data-[state=open]:bg-accent/10 data-[state=open]:text-accent hover:bg-surface-secondary/60 flex h-6.5 w-6.5 shrink-0 cursor-pointer items-center justify-center rounded-md"
                    title="Open view"
                    aria-label="Add tab"
                  >
                    <Plus className="icon-compact" />
                  </button>
                </Dropdown.Trigger>
                <Dropdown.Portal>
                  <Dropdown.Content align="start" className="w-56">
                    <div className="text-role-eyebrow text-text-muted/60 px-2.5 py-1.5">
                      Open in Workbench
                    </div>

                    {STATIC_TABS.map((item) => {
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

            {/* Right: Maximize */}
            {onToggleMaximize && (
              <div className="flex shrink-0 items-center pl-1">
                <Tooltip content={isMaximized ? 'Restore Workbench' : 'Maximize Workbench'}>
                  <button
                    type="button"
                    onClick={onToggleMaximize}
                    className="motion-disclosure text-text-muted hover:text-text-main hover:bg-surface-secondary flex h-6.5 w-6.5 cursor-pointer items-center justify-center rounded-md transition-colors"
                    aria-label={isMaximized ? 'Restore Workbench' : 'Maximize Workbench'}
                  >
                    {isMaximized ? (
                      <Minimize2 className="icon-compact" />
                    ) : (
                      <Maximize2 className="icon-compact" />
                    )}
                  </button>
                </Tooltip>
              </div>
            )}
          </div>

          {/* Tab Content */}
          <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
            {tabs.length === 0 ? (
              <div className="bg-surface/20 flex h-full flex-col items-center justify-center p-8 text-center">
                <div className="border-border/30 bg-surface/50 max-w-sm rounded-2xl border p-6 backdrop-blur-md">
                  <div className="border-border/20 bg-surface-secondary/40 text-text-muted mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-xl border">
                    <Layout className="h-5 w-5" />
                  </div>
                  <h3 className="text-role-body text-text-main font-semibold">
                    No open workbench tabs
                  </h3>
                  <p className="text-role-caption text-text-muted mt-1 text-xs">
                    Select a tab below or use the + menu in the top bar to inspect your workspace.
                  </p>

                  <div className="mt-4 flex flex-col gap-2">
                    {STATIC_TABS.map((item) => {
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
