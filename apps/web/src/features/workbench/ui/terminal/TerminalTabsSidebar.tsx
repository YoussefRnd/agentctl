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

function TerminalTreeBranch({ isFirst, isLast }: { isFirst: boolean; isLast: boolean }) {
  const path = isFirst ? 'M7 14V7h7' : isLast ? 'M7 0v7h7' : 'M7 0v14 M7 7h7';
  return (
    <span
      className="text-border/70 flex h-3.5 w-3.5 shrink-0 items-center justify-center"
      aria-hidden="true"
    >
      <svg className="h-3.5 w-3.5" viewBox="0 0 14 14" fill="none" stroke="currentColor">
        <path d={path} strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}

export function TerminalTabsSidebar({ sessionId }: { sessionId: string }) {
  const workspace = useTerminalTabsStore((s) => s.workspaces[sessionId]);
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

  const tabs = workspace?.tabs ?? [];
  const activeTabId = workspace?.activeTabId ?? '';
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
        renamePane(sessionId, tabId, paneId, trimmed);
      } else {
        renameTab(sessionId, tabId, trimmed);
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
    return (
      <span aria-hidden="true" className={`h-1.5 w-1.5 shrink-0 rounded-full ${colorClass}`} />
    );
  };

  return (
    <aside
      data-font-ctx="terminal-sidebar"
      className="border-border/20 bg-surface/40 flex h-full w-48 shrink-0 flex-col border-l backdrop-blur-md select-none"
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
              onClick={() => addTab(sessionId)}
              className="motion-disclosure text-text-muted hover:text-text-main hover:bg-surface-secondary flex h-8 w-8 items-center justify-center rounded-md transition-colors"
              aria-label="New terminal"
            >
              <Plus className="icon-inline" />
            </button>
          </Tooltip>

          <Tooltip content="Split Active Terminal">
            <button
              type="button"
              onClick={() => splitTab(sessionId)}
              className="motion-disclosure text-text-muted hover:text-text-main hover:bg-surface-secondary flex h-8 w-8 items-center justify-center rounded-md transition-colors"
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
                onClick={() => toggleSplitOrientation(sessionId, activeTab.id)}
                className="motion-disclosure text-text-muted hover:text-text-main hover:bg-surface-secondary flex h-8 w-8 items-center justify-center rounded-md transition-colors"
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
              onClick={() => toggleSidebar(sessionId)}
              className="motion-disclosure text-text-muted hover:text-text-main hover:bg-surface-secondary flex h-8 w-8 items-center justify-center rounded-md transition-colors"
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
                className={`group/row relative flex h-7 items-center justify-between rounded px-1 font-mono text-xs transition-colors ${
                  isTabActive
                    ? 'bg-surface-secondary/70 text-text-main ring-border/30 font-medium shadow-2xs ring-1'
                    : 'text-text-muted hover:text-text-main hover:bg-surface-secondary/30'
                }`}
              >
                {isEditing ? (
                  <div className="flex min-w-0 flex-1 items-center gap-1.5 px-0.5">
                    <span className="text-text-muted/50 w-2.5 shrink-0 text-right text-[10px] tabular-nums">
                      {tabIndex + 1}
                    </span>
                    {singlePane && renderStatusDot(singlePane.status)}
                    <input
                      ref={editInputRef}
                      type="text"
                      aria-label="Terminal name"
                      value={editingTitle}
                      onChange={(e) => setEditingTitle(e.target.value)}
                      onBlur={() => handleFinishRename(tab.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleFinishRename(tab.id);
                        if (e.key === 'Escape') setEditingItemId(null);
                      }}
                      className="bg-surface ring-accent/60 h-6 min-w-0 flex-1 rounded px-1 text-xs text-inherit ring-1 outline-hidden"
                    />
                  </div>
                ) : (
                  <button
                    type="button"
                    aria-pressed={isTabActive}
                    aria-label={`${tab.name}, ${singlePane?.status ?? 'unknown status'}`}
                    onClick={() => setActiveTab(sessionId, tab.id)}
                    onDoubleClick={(e) => handleStartRename(tab.id, tab.name, e)}
                    className="focus-visible:ring-accent/40 flex h-full min-w-0 flex-1 cursor-pointer items-center gap-1.5 rounded px-0.5 text-left focus-visible:ring-1 focus-visible:outline-none"
                  >
                    <span className="text-text-muted/50 w-2.5 shrink-0 text-right text-[10px] tabular-nums">
                      {tabIndex + 1}
                    </span>
                    {singlePane && renderStatusDot(singlePane.status)}
                    <TerminalIcon className="icon-inline text-text-muted/70 shrink-0" />
                    <span className="truncate">{tab.name}</span>
                  </button>
                )}

                {/* Hover Actions */}
                <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-focus-within/row:opacity-100 group-hover/row:opacity-100">
                  <Tooltip content="Split Terminal">
                    <button
                      type="button"
                      onClick={() => splitTab(sessionId, tab.id)}
                      className="motion-disclosure text-text-muted hover:text-text-main hover:bg-surface flex h-7 w-7 items-center justify-center rounded transition-colors"
                      aria-label="Split terminal"
                    >
                      <Columns2 className="h-2.5 w-2.5" />
                    </button>
                  </Tooltip>

                  <Tooltip content="Kill Terminal">
                    <button
                      type="button"
                      onClick={() => closeTab(sessionId, tab.id)}
                      className="motion-disclosure text-text-muted hover:bg-surface flex h-7 w-7 items-center justify-center rounded transition-colors hover:text-rose-400"
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
                    className={`group/pane relative flex h-7 items-center justify-between rounded px-1 font-mono text-xs transition-colors ${
                      isPaneActive
                        ? 'bg-surface-secondary/80 text-text-main ring-accent/40 font-medium shadow-2xs ring-1'
                        : isTabActive
                          ? 'text-text-main/80 hover:bg-surface-secondary/40'
                          : 'text-text-muted hover:text-text-main hover:bg-surface-secondary/30'
                    }`}
                  >
                    {isEditing ? (
                      <div className="flex min-w-0 flex-1 items-center gap-1.5 px-0.5">
                        <span className="text-text-muted/50 w-2.5 shrink-0 text-right text-[10px] tabular-nums">
                          {isFirst ? `${tabIndex + 1}` : ''}
                        </span>
                        <TerminalTreeBranch isFirst={isFirst} isLast={isLast} />
                        {renderStatusDot(pane.status)}
                        <input
                          ref={editInputRef}
                          type="text"
                          aria-label="Terminal pane name"
                          value={editingTitle}
                          onChange={(e) => setEditingTitle(e.target.value)}
                          onBlur={() => handleFinishRename(tab.id, pane.id)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleFinishRename(tab.id, pane.id);
                            if (e.key === 'Escape') setEditingItemId(null);
                          }}
                          className="bg-surface ring-accent/60 h-6 min-w-0 flex-1 rounded px-1 text-xs text-inherit ring-1 outline-hidden"
                        />
                      </div>
                    ) : (
                      <button
                        type="button"
                        aria-pressed={isPaneActive}
                        aria-label={`${pane.name}, ${pane.status}`}
                        onClick={() => setActivePane(sessionId, tab.id, pane.id)}
                        onDoubleClick={(e) => handleStartRename(pane.id, pane.name, e)}
                        className="focus-visible:ring-accent/40 flex h-full min-w-0 flex-1 cursor-pointer items-center gap-1.5 rounded px-0.5 text-left focus-visible:ring-1 focus-visible:outline-none"
                      >
                        <span className="text-text-muted/50 w-2.5 shrink-0 text-right text-[10px] tabular-nums">
                          {isFirst ? `${tabIndex + 1}` : ''}
                        </span>
                        <TerminalTreeBranch isFirst={isFirst} isLast={isLast} />
                        {renderStatusDot(pane.status)}
                        <span className="truncate">{pane.name}</span>
                      </button>
                    )}

                    {/* Quick Actions on Pane Hover */}
                    <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-focus-within/pane:opacity-100 group-hover/pane:opacity-100">
                      <Tooltip content="Split Again">
                        <button
                          type="button"
                          onClick={() => splitTab(sessionId, tab.id)}
                          className="motion-disclosure text-text-muted hover:text-text-main hover:bg-surface flex h-7 w-7 items-center justify-center rounded transition-colors"
                          aria-label="Split terminal"
                        >
                          <Plus className="h-2.5 w-2.5" />
                        </button>
                      </Tooltip>

                      <Tooltip content="Close Pane">
                        <button
                          type="button"
                          onClick={() => closePane(sessionId, tab.id, pane.id)}
                          className="motion-disclosure text-text-muted hover:bg-surface flex h-7 w-7 items-center justify-center rounded transition-colors hover:text-rose-400"
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
