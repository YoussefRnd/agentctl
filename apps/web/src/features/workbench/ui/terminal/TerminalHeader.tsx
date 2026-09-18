import { useState } from 'react';
import { RotateCcw, Trash2, Plus, X, Terminal } from 'lucide-react';
import { Button, Tooltip } from '@agentctl/ui';

export interface TerminalTabItem {
  id: string;
  name: string;
}

interface TerminalHeaderProps {
  tabs: TerminalTabItem[];
  activeTabId: string;
  onSelectTab: (id: string) => void;
  onAddTab: () => void;
  onCloseTab: (id: string) => void;
  onRenameTab: (id: string, name: string) => void;
  status: 'connecting' | 'connected' | 'disconnected';
  shellName: string;
  reconnect: () => void;
  handleRestart: () => void;
  handleClear: () => void;
}

export function TerminalHeader({
  tabs,
  activeTabId,
  onSelectTab,
  onAddTab,
  onCloseTab,
  onRenameTab,
  status,
  shellName,
  reconnect,
  handleRestart,
  handleClear,
}: TerminalHeaderProps) {
  const [editingTabId, setEditingTabId] = useState<string | null>(null);
  const [editNameValue, setEditNameValue] = useState('');

  const handleStartRename = (tab: TerminalTabItem) => {
    setEditingTabId(tab.id);
    setEditNameValue(tab.name);
  };

  const handleFinishRename = (id: string) => {
    const trimmed = editNameValue.trim();
    if (trimmed) {
      onRenameTab(id, trimmed);
    }
    setEditingTabId(null);
  };

  return (
    <div className="border-border/20 bg-surface-secondary/20 flex h-9 shrink-0 items-center justify-between border-b px-2 text-xs select-none">
      {/* Left: Tab Strip */}
      <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto py-1">
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId;
          const isEditing = editingTabId === tab.id;

          return (
            <div
              key={tab.id}
              onClick={() => {
                if (!isActive) onSelectTab(tab.id);
              }}
              onMouseDown={(e) => {
                if (e.button === 1) {
                  e.preventDefault();
                  onCloseTab(tab.id);
                }
              }}
              onDoubleClick={() => handleStartRename(tab)}
              className={`group/tab relative flex h-7 max-w-[130px] min-w-[70px] cursor-pointer items-center justify-between gap-1.5 rounded-md border px-2 text-[11px] font-medium transition-all ${
                isActive
                  ? 'border-accent/40 bg-surface text-accent shadow-sm'
                  : 'text-text-muted hover:bg-surface-secondary/40 hover:text-text-main border-transparent bg-transparent hover:border-white/5'
              }`}
            >
              {isEditing ? (
                <input
                  type="text"
                  value={editNameValue}
                  autoFocus
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => setEditNameValue(e.target.value)}
                  onBlur={() => handleFinishRename(tab.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleFinishRename(tab.id);
                    if (e.key === 'Escape') setEditingTabId(null);
                  }}
                  className="text-text-main w-full bg-transparent outline-none"
                />
              ) : (
                <>
                  <div className="flex min-w-0 items-center gap-1">
                    <Terminal className="h-3.5 w-3.5 shrink-0 opacity-60" />
                    <span className="truncate">{tab.name}</span>
                  </div>

                  {tabs.length > 1 && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onCloseTab(tab.id);
                      }}
                      className="text-text-muted -mr-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded opacity-0 transition-opacity group-hover/tab:opacity-100 hover:text-rose-400"
                      title="Close terminal tab"
                      aria-label="Close terminal tab"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </>
              )}
            </div>
          );
        })}

        {/* Add Tab Button */}
        <button
          type="button"
          onClick={onAddTab}
          className="text-text-muted hover:text-accent hover:bg-surface-secondary/40 flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-md transition-colors"
          title="Open new terminal tab"
          aria-label="New terminal tab"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Right: Status & Actions */}
      <div className="flex shrink-0 items-center gap-1.5 pl-2">
        <div className="border-border/20 bg-surface/40 text-text-muted flex items-center gap-1.5 rounded-md border px-2 py-0.5 font-mono text-[10px]">
          <span
            className={`h-1.5 w-1.5 rounded-full ${
              status === 'connected'
                ? 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.7)]'
                : status === 'connecting'
                  ? 'animate-pulse bg-amber-400'
                  : 'bg-rose-500'
            }`}
          />
          <span className="opacity-80">{shellName}</span>
        </div>

        {status === 'disconnected' && (
          <Button
            variant="outline"
            size="sm"
            onClick={reconnect}
            className="!h-5.5 !px-2 text-[10px]"
          >
            Reconnect
          </Button>
        )}

        <Tooltip content="Restart shell process">
          <button
            type="button"
            onClick={handleRestart}
            className="text-text-muted hover:text-text-main hover:bg-surface-secondary flex h-6 w-6 cursor-pointer items-center justify-center rounded-md transition-colors active:scale-[0.95]"
            aria-label="Restart shell"
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </button>
        </Tooltip>

        <Tooltip content="Clear scrollback">
          <button
            type="button"
            onClick={handleClear}
            className="text-text-muted hover:text-text-main hover:bg-surface-secondary flex h-6 w-6 cursor-pointer items-center justify-center rounded-md transition-colors active:scale-[0.95]"
            aria-label="Clear terminal"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </Tooltip>
      </div>
    </div>
  );
}
