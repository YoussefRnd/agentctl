import { useImperativeHandle, forwardRef } from 'react';
import { useTerminalPane } from '../../model/useTerminalPane';
import type { TerminalPaneHandle, TerminalPaneProps } from '../../model/terminal-types';
export type { TerminalPaneHandle, TerminalPaneProps } from '../../model/terminal-types';
import '@xterm/xterm/css/xterm.css';
import { X, Columns2, Rows2 } from 'lucide-react';
import { Tooltip } from '@agentctl/ui';

export const TerminalPane = forwardRef<TerminalPaneHandle, TerminalPaneProps>(function TerminalPane(
  {
    id,
    name: _name,
    sessionId,
    isActive,
    isSplit,
    splitOrientation = 'horizontal',
    codeFont,
    onFocus,
    onClose,
    onToggleOrientation,
    onShellChange,
    onStatusChange,
  },
  ref,
) {
  const {
    terminalRef,
    shellName,
    status,
    reconnect,
    handleRestart,
    handleClear,
    handleFocus,
    handleFit,
  } = useTerminalPane({
    id,
    name: _name,
    sessionId,
    isActive,
    isSplit,
    codeFont,
    onFocus,
    onShellChange,
    onStatusChange,
  });
  useImperativeHandle(
    ref,
    () => ({ restart: handleRestart, clear: handleClear, focus: handleFocus, fit: handleFit }),
    [handleRestart, handleClear, handleFocus, handleFit],
  );
  return (
    <div
      className="group/pane relative flex h-full min-w-0 flex-1 flex-col overflow-hidden bg-[#11111b]"
      onPointerDownCapture={handleFocus}
      onClick={handleFocus}
    >
      {/* Split Pane Sub-Header: Only visible when multiple panes are split */}
      {isSplit && (
        <div
          className={`flex h-5.5 shrink-0 items-center justify-between border-b px-2 font-mono text-[10px] transition-colors select-none ${
            isActive
              ? 'border-border/30 bg-surface/30 text-text-main'
              : 'border-border/15 bg-surface/5 text-text-muted/70 hover:text-text-main'
          }`}
        >
          <div className="flex min-w-0 items-center gap-1.5">
            <Tooltip
              content={
                status === 'connected'
                  ? `Connected (${shellName || 'sh'})`
                  : status === 'connecting'
                    ? 'Connecting...'
                    : 'Disconnected (Click to reconnect)'
              }
            >
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  if (status === 'disconnected') {
                    reconnect();
                  }
                }}
                className={`flex items-center gap-1.5 rounded px-1 py-0.5 transition-colors ${
                  status === 'disconnected'
                    ? 'cursor-pointer hover:bg-rose-500/20'
                    : 'cursor-default'
                }`}
                aria-label={status === 'connected' ? 'Connected' : 'Reconnect terminal'}
              >
                <span
                  className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                    status === 'connected'
                      ? 'bg-emerald-400 shadow-[0_0_4px_rgba(52,211,153,0.6)]'
                      : status === 'connecting'
                        ? 'animate-pulse bg-amber-400'
                        : 'bg-rose-500'
                  }`}
                />
                <span className="truncate">{shellName || 'sh'}</span>
              </button>
            </Tooltip>
          </div>

          <div className="flex items-center gap-1">
            {onToggleOrientation && (
              <Tooltip
                content={`Switch to ${splitOrientation === 'horizontal' ? 'Vertical (Top/Bottom)' : 'Horizontal (Side-by-side)'} Split`}
              >
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleOrientation();
                  }}
                  className="motion-disclosure text-text-muted/60 hover:text-text-main hover:bg-surface-secondary flex h-3.5 w-3.5 items-center justify-center rounded transition-colors"
                  aria-label="Toggle split orientation"
                >
                  {splitOrientation === 'horizontal' ? (
                    <Rows2 className="h-2.5 w-2.5" />
                  ) : (
                    <Columns2 className="h-2.5 w-2.5" />
                  )}
                </button>
              </Tooltip>
            )}

            {onClose && (
              <Tooltip content="Close pane">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onClose(id);
                  }}
                  className="motion-disclosure text-text-muted/60 hover:bg-surface-secondary flex h-3.5 w-3.5 items-center justify-center rounded transition-colors hover:text-rose-400"
                  aria-label="Close pane"
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              </Tooltip>
            )}
          </div>
        </div>
      )}

      {/* Terminal Canvas Container */}
      <div
        className="relative min-h-0 flex-1 cursor-text bg-[#11111b] px-2 py-1.5"
        onPointerDownCapture={handleFocus}
        onClick={handleFocus}
      >
        <div ref={terminalRef} className="h-full w-full overflow-hidden font-mono" />
      </div>
    </div>
  );
});
