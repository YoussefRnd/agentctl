import { useState, useRef, useEffect } from 'react';
import {
  Terminal as TerminalIcon,
  Plus,
  Columns2,
  Rows2,
  Trash2,
  X,
  PanelRightClose,
} from 'lucide-react';
import { Tooltip } from '@agentctl/ui';
import {
  useTerminalTabsStore,
  type TerminalTabData,
  type TerminalPaneData,
} from '../../model/useTerminalTabsStore';

export function TerminalTabsSidebar() {
  const tabs = useTerminalTabsStore((s) => s.tabs);
  const activeTabId = useTerminalTabsStore((s) => s.activeTabId);
  const addTab = useTerminalTabsStore((s) => s.addTab);
  const closeTab = useTerminalTabsStore((s) => s.closeTab);
  const setActiveTab = useTerminalTabsStore((s) => s.setActiveTab);
  const renameTab = useTerminalTabsStore((s) => s.renameTab);
  const splitTab = useTerminalTabsStore((s) => s.splitTab);
  const closePane = useTerminalTabsStore((s) => s.closePane);
  const setActivePane = useTerminalTabsStore((s) => s.setActivePane);
  const renamePane = useTerminalTabsStore((s) => s.renamePane);
  const toggleSplitOrientation = useTerminalTabsStore((s) => s.toggleSplitOrientation);
  const toggleSidebar = useTerminalTabsStore((s) => s.toggleSidebar);

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? tabs[0];
  const isCurrentTabSplit = Boolean(activeTab && activeTab.panes.length > 1);

  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState<string>('');
  const editInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editingItemId && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingItemId]);

  const handleStartRename = (id: string, currentName: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingItemId(id);
    setEditingTitle(currentName);
  };

  const handleFinishRename = (tabId: string, paneId?: string) => {
    const trimmed = editingTitle.trim();
    if (trimmed) {
      if (paneId) {
        renamePane(tabId, paneId, trimmed);
      } else {
        renameTab(tabId, trimmed);
      }
    }
    setEditingItemId(null);
  };

  const renderStatusDot = (status: 'connecting' | 'connected' | 'disconnected') => {
    let colorClass = 'bg-rose-500';
    if (status === 'connected') {
      colorClass = 'bg-emerald-400 shadow-[0_0_5px_rgba(52,211,153,0.6)]';
    } else if (status === 'connecting') {
      colorClass = 'bg-amber-400 animate-pulse';
    }
    return <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${colorClass}`} />;
  };

  return (
    <aside
      data-font-ctx="terminal-sidebar"
      className="border-border/20 bg-surface/40 flex h-full w-44 shrink-0 flex-col border-l backdrop-blur-md select-none"
      aria-label="Terminal tabs"
    >
      {/* Sidebar Header */}
      <div className="border-border/15 flex h-8 shrink-0 items-center justify-between border-b px-2.5">
        <div className="flex items-center gap-1.5">
          <span className="text-text-muted/60 text-[10px] font-semibold tracking-wider uppercase">
            Terminals
          </span>
          {tabs.length > 1 && (
            <span className="bg-surface-secondary text-text-muted/70 py-0.2 rounded px-1 font-mono text-[9px]">
              {tabs.length}
            </span>
          )}
        </div>

        <div className="flex items-center gap-0.5">
          <Tooltip content="New Terminal">
            <button
              type="button"
              onClick={() => addTab()}
              className="motion-disclosure text-text-muted hover:text-text-main hover:bg-surface-secondary flex h-5 w-5 items-center justify-center rounded transition-colors"
              aria-label="New terminal"
            >
              <Plus className="icon-inline" />
            </button>
          </Tooltip>

          <Tooltip content="Split Active Terminal">
            <button
              type="button"
              onClick={() => splitTab()}
              className="motion-disclosure text-text-muted hover:text-text-main hover:bg-surface-secondary flex h-5 w-5 items-center justify-center rounded transition-colors"
              aria-label="Split active terminal"
            >
              <Columns2 className="icon-inline" />
            </button>
          </Tooltip>

          {isCurrentTabSplit && (
            <Tooltip
              content={`Switch to ${activeTab.splitOrientation === 'horizontal' ? 'Vertical' : 'Horizontal'} Split`}
            >
              <button
                type="button"
                onClick={() => toggleSplitOrientation(activeTab.id)}
                className="motion-disclosure text-text-muted hover:text-text-main hover:bg-surface-secondary flex h-5 w-5 items-center justify-center rounded transition-colors"
                aria-label="Toggle split orientation"
              >
                {activeTab.splitOrientation === 'horizontal' ? (
                  <Rows2 className="icon-inline" />
                ) : (
                  <Columns2 className="icon-inline" />
                )}
              </button>
            </Tooltip>
          )}

          <Tooltip content="Hide Terminal Tabs">
            <button
              type="button"
              onClick={toggleSidebar}
              className="motion-disclosure text-text-muted hover:text-text-main hover:bg-surface-secondary flex h-5 w-5 items-center justify-center rounded transition-colors"
              aria-label="Hide tabs"
            >
              <PanelRightClose className="icon-inline" />
            </button>
          </Tooltip>
        </div>
      </div>

      {/* Terminal Sessions List */}
      <div className="flex-1 space-y-0.5 overflow-y-auto p-1">
        {tabs.map((tab: TerminalTabData, tabIndex: number) => {
          const isTabActive = tab.id === activeTabId;
          const isSplitGroup = tab.panes.length > 1;

          if (!isSplitGroup) {
            // Single Pane Tab
            const singlePane = tab.panes[0];
            const isEditing = editingItemId === tab.id;

            return (
              <div
                key={tab.id}
                role="button"
                tabIndex={0}
                onClick={() => setActiveTab(tab.id)}
                onDoubleClick={(e) => handleStartRename(tab.id, tab.name, e)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    setActiveTab(tab.id);
                  }
                }}
                className={`group/row relative flex h-6.5 cursor-pointer items-center justify-between rounded px-1.5 font-mono text-xs transition-colors ${
                  isTabActive
                    ? 'bg-surface-secondary/70 text-text-main ring-border/30 font-medium shadow-2xs ring-1'
                    : 'text-text-muted hover:text-text-main hover:bg-surface-secondary/30'
                }`}
              >
                <div className="flex min-w-0 items-center gap-1.5">
                  <span className="text-text-muted/50 w-2.5 shrink-0 text-right text-[10px] tabular-nums">
                    {tabIndex + 1}
                  </span>
                  {singlePane && renderStatusDot(singlePane.status)}
                  <TerminalIcon className="icon-inline text-text-muted/70 shrink-0" />
                  {isEditing ? (
                    <input
                      ref={editInputRef}
                      type="text"
                      value={editingTitle}
                      onChange={(e) => setEditingTitle(e.target.value)}
                      onBlur={() => handleFinishRename(tab.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleFinishRename(tab.id);
                        if (e.key === 'Escape') setEditingItemId(null);
                      }}
                      onClick={(e) => e.stopPropagation()}
                      className="bg-surface ring-accent/60 h-4.5 w-24 rounded px-1 text-xs text-inherit ring-1 outline-hidden"
                    />
                  ) : (
                    <span className="truncate">{tab.name}</span>
                  )}
                </div>

                {/* Hover Actions */}
                <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover/row:opacity-100">
                  <Tooltip content="Split Terminal">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        splitTab(tab.id);
                      }}
                      className="motion-disclosure text-text-muted hover:text-text-main hover:bg-surface flex h-4.5 w-4.5 items-center justify-center rounded transition-colors"
                      aria-label="Split terminal"
                    >
                      <Columns2 className="h-2.5 w-2.5" />
                    </button>
                  </Tooltip>

                  <Tooltip content="Kill Terminal">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        closeTab(tab.id);
                      }}
                      className="motion-disclosure text-text-muted hover:bg-surface flex h-4.5 w-4.5 items-center justify-center rounded transition-colors hover:text-rose-400"
                      aria-label="Kill terminal"
                    >
                      <Trash2 className="h-2.5 w-2.5" />
                    </button>
                  </Tooltip>
                </div>
              </div>
            );
          }

          // Split Pane Group: Rendered inline without a dummy parent row
          return (
            <div key={tab.id} className="relative space-y-0.5">
              {tab.panes.map((pane: TerminalPaneData, paneIndex: number) => {
                const isPaneActive = isTabActive && pane.id === tab.activePaneId;
                const isEditing = editingItemId === pane.id;
                const isFirst = paneIndex === 0;
                const isLast = paneIndex === tab.panes.length - 1;

                return (
                  <div
                    key={pane.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => setActivePane(tab.id, pane.id)}
                    onDoubleClick={(e) => handleStartRename(pane.id, pane.name, e)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        setActivePane(tab.id, pane.id);
                      }
                    }}
                    className={`group/pane relative flex h-6.5 cursor-pointer items-center justify-between rounded px-1.5 font-mono text-xs transition-colors ${
                      isPaneActive
                        ? 'bg-surface-secondary/80 text-text-main ring-accent/40 font-medium shadow-2xs ring-1'
                        : isTabActive
                          ? 'text-text-main/80 hover:bg-surface-secondary/40'
                          : 'text-text-muted hover:text-text-main hover:bg-surface-secondary/30'
                    }`}
                  >
                    <div className="flex min-w-0 items-center gap-1.5">
                      {/* Left Tab Index (only on first pane of group) */}
                      <span className="text-text-muted/50 w-2.5 shrink-0 text-right text-[10px] tabular-nums">
                        {isFirst ? `${tabIndex + 1}` : ''}
                      </span>

                      {/* Tree Branch Vector */}
                      <div className="text-border/70 flex h-3.5 w-3.5 shrink-0 items-center justify-center">
                        {isFirst ? (
                          <svg
                            className="h-3.5 w-3.5"
                            viewBox="0 0 14 14"
                            fill="none"
                            stroke="currentColor"
                          >
                            <path
                              d="M7 14V7h7"
                              strokeWidth="1.2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </svg>
                        ) : isLast ? (
                          <svg
                            className="h-3.5 w-3.5"
                            viewBox="0 0 14 14"
                            fill="none"
                            stroke="currentColor"
                          >
                            <path
                              d="M7 0v7h7"
                              strokeWidth="1.2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </svg>
                        ) : (
                          <svg
                            className="h-3.5 w-3.5"
                            viewBox="0 0 14 14"
                            fill="none"
                            stroke="currentColor"
                          >
                            <path
                              d="M7 0v14 M7 7h7"
                              strokeWidth="1.2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </svg>
                        )}
                      </div>

                      {renderStatusDot(pane.status)}

                      {isEditing ? (
                        <input
                          ref={editInputRef}
                          type="text"
                          value={editingTitle}
                          onChange={(e) => setEditingTitle(e.target.value)}
                          onBlur={() => handleFinishRename(tab.id, pane.id)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleFinishRename(tab.id, pane.id);
                            if (e.key === 'Escape') setEditingItemId(null);
                          }}
                          onClick={(e) => e.stopPropagation()}
                          className="bg-surface ring-accent/60 h-4.5 w-20 rounded px-1 text-xs text-inherit ring-1 outline-hidden"
                        />
                      ) : (
                        <span className="truncate">{pane.name}</span>
                      )}
                    </div>

                    {/* Quick Actions on Pane Hover */}
                    <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover/pane:opacity-100">
                      <Tooltip content="Split Again">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            splitTab(tab.id);
                          }}
                          className="motion-disclosure text-text-muted hover:text-text-main hover:bg-surface flex h-4.5 w-4.5 items-center justify-center rounded transition-colors"
                          aria-label="Split terminal"
                        >
                          <Plus className="h-2.5 w-2.5" />
                        </button>
                      </Tooltip>

                      <Tooltip content="Close Pane">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            closePane(tab.id, pane.id);
                          }}
                          className="motion-disclosure text-text-muted hover:bg-surface flex h-4.5 w-4.5 items-center justify-center rounded transition-colors hover:text-rose-400"
                          aria-label="Close pane"
                        >
                          <X className="h-2.5 w-2.5" />
                        </button>
                      </Tooltip>
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </aside>
  );
}
