import { useEffect, useRef, useState, useCallback, useImperativeHandle, forwardRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';
import { X, Columns2, Rows2 } from 'lucide-react';
import { Tooltip } from '@agentctl/ui';
import { getApiBaseUrl } from '@/shared/lib/api-base-url';
import { getAuthToken } from '@agentctl/api-client';

const NERD_FONT_FAMILY = [
  '"JetBrainsMono Nerd Font"',
  '"FiraCode Nerd Font"',
  '"CaskaydiaCove Nerd Font"',
  '"MesloLGS NF"',
  '"Symbols Nerd Font"',
  '"Geist Mono"',
  '"JetBrains Mono"',
  '"Fira Code"',
  '"Cascadia Code"',
  'Menlo',
  'Monaco',
  'Consolas',
  'monospace',
].join(', ');

export interface TerminalPaneHandle {
  restart: () => void;
  clear: () => void;
  focus: () => void;
  fit: () => void;
}

export interface TerminalPaneProps {
  id: string;
  name: string;
  sessionId: string;
  isActive: boolean;
  isSplit: boolean;
  splitOrientation?: 'horizontal' | 'vertical';
  codeFont?: { family?: string; size?: number };
  onFocus: (id: string) => void;
  onClose?: (id: string) => void;
  onToggleOrientation?: () => void;
  onShellChange?: (id: string, shell: string) => void;
  onStatusChange?: (id: string, status: 'connecting' | 'connected' | 'disconnected') => void;
}

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
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermInstance = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const queuedInputRef = useRef<string[]>([]);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const connectCountRef = useRef<number>(0);

  const [shellName, setShellName] = useState<string>('sh');
  const [status, setStatus] = useState<'connecting' | 'connected' | 'disconnected'>('connecting');
  const [connectKey, setConnectKey] = useState<number>(0);

  // Store callbacks in refs to prevent unnecessary re-initialization
  const onFocusRef = useRef(onFocus);
  onFocusRef.current = onFocus;

  const onStatusChangeRef = useRef(onStatusChange);
  onStatusChangeRef.current = onStatusChange;

  const onShellChangeRef = useRef(onShellChange);
  onShellChangeRef.current = onShellChange;

  const isActiveRef = useRef(isActive);
  isActiveRef.current = isActive;

  const statusRef = useRef(status);
  statusRef.current = status;

  const handleStatusUpdate = useCallback(
    (newStatus: 'connecting' | 'connected' | 'disconnected') => {
      setStatus(newStatus);
      statusRef.current = newStatus;
      onStatusChangeRef.current?.(id, newStatus);
    },
    [id],
  );

  const reconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    handleStatusUpdate('connecting');
    setConnectKey((k) => k + 1);
  }, [handleStatusUpdate]);

  const lastSentCols = useRef<number>(0);
  const lastSentRows = useRef<number>(0);
  const resizeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const sendResize = useCallback((cols: number, rows: number) => {
    if (cols <= 0 || rows <= 0) return;
    if (cols === lastSentCols.current && rows === lastSentRows.current) return;

    if (resizeTimerRef.current) {
      clearTimeout(resizeTimerRef.current);
    }

    resizeTimerRef.current = setTimeout(() => {
      if (
        socketRef.current?.readyState === WebSocket.OPEN &&
        (cols !== lastSentCols.current || rows !== lastSentRows.current)
      ) {
        lastSentCols.current = cols;
        lastSentRows.current = rows;
        socketRef.current.send(JSON.stringify({ type: 'resize', cols, rows }));
      }
    }, 60);
  }, []);

  const handleRestart = useCallback(() => {
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({ type: 'restart' }));
    } else {
      reconnect();
    }
  }, [reconnect]);

  const handleClear = useCallback(() => {
    xtermInstance.current?.clear();
  }, []);

  const handleFocus = useCallback(() => {
    if (statusRef.current === 'disconnected') {
      reconnect();
    }
    xtermInstance.current?.focus();
    xtermInstance.current?.textarea?.focus();
    onFocusRef.current?.(id);
  }, [id, reconnect]);

  const handleFit = useCallback(() => {
    try {
      if (fitAddonRef.current && xtermInstance.current) {
        fitAddonRef.current.fit();
        sendResize(xtermInstance.current.cols, xtermInstance.current.rows);
      }
    } catch {
      // Ignore fit measurement errors
    }
  }, [sendResize]);

  // Expose imperative actions to parent
  useImperativeHandle(
    ref,
    () => ({
      restart: handleRestart,
      clear: handleClear,
      focus: handleFocus,
      fit: handleFit,
    }),
    [handleRestart, handleClear, handleFocus, handleFit],
  );

  // 1. Terminal DOM & Addons Lifecycle (Mounted once per pane)
  useEffect(() => {
    if (!terminalRef.current || !sessionId) return;

    let term: Terminal | null = null;
    let fitAddon: FitAddon | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let resizeRaf: number | null = null;
    let onTextareaFocus: (() => void) | null = null;

    try {
      term = new Terminal({
        cursorBlink: true,
        cursorStyle: 'block',
        cursorInactiveStyle: 'outline',
        fontSize: codeFont?.size ?? 13,
        lineHeight: 1.25,
        fontFamily: codeFont?.family
          ? `"${codeFont.family}", ${NERD_FONT_FAMILY}`
          : NERD_FONT_FAMILY,
        theme: {
          background: '#11111b',
          foreground: '#cdd6f4',
          cursor: '#f5e0dc',
          cursorAccent: '#11111b',
          selectionBackground: 'rgba(203, 166, 247, 0.25)',
          black: '#45475a',
          red: '#f38ba8',
          green: '#a6e3a1',
          yellow: '#f9e2af',
          blue: '#89b4fa',
          magenta: '#cba6f7',
          cyan: '#94e2d5',
          white: '#bac2de',
          brightBlack: '#585b70',
          brightRed: '#f38ba8',
          brightGreen: '#a6e3a1',
          brightYellow: '#f9e2af',
          brightBlue: '#89b4fa',
          brightMagenta: '#cba6f7',
          brightCyan: '#94e2d5',
          brightWhite: '#a6adc8',
        },
        convertEol: true,
        allowTransparency: true,
        scrollback: 10000,
        smoothScrollDuration: 100,
        macOptionIsMeta: true,
      });

      fitAddon = new FitAddon();
      term.loadAddon(fitAddon);
      term.loadAddon(new WebLinksAddon());

      term.open(terminalRef.current);
      fitAddon.fit();

      xtermInstance.current = term;
      fitAddonRef.current = fitAddon;

      // Smart Keyboard handler: Copy on selection with Ctrl+C, paste with Ctrl+V
      term.attachCustomKeyEventHandler((event: KeyboardEvent) => {
        const isCtrlOrCmd = event.ctrlKey || event.metaKey;

        // Copy when text is selected
        if (isCtrlOrCmd && event.key.toLowerCase() === 'c' && event.type === 'keydown') {
          if (term?.hasSelection()) {
            const selection = term.getSelection();
            void navigator.clipboard.writeText(selection);
            return false;
          }
        }

        // Paste with Ctrl+V / Cmd+V
        if (isCtrlOrCmd && event.key.toLowerCase() === 'v' && event.type === 'keydown') {
          void navigator.clipboard.readText().then((text) => {
            if (text) {
              if (socketRef.current?.readyState === WebSocket.OPEN) {
                socketRef.current.send(JSON.stringify({ type: 'input', data: text }));
              } else {
                queuedInputRef.current.push(text);
                if (statusRef.current === 'disconnected') {
                  reconnect();
                }
              }
            }
          });
          return false;
        }

        return true;
      });

      // Handle user keyboard input: write immediately or queue and reconnect if disconnected
      term.onData((data) => {
        if (socketRef.current?.readyState === WebSocket.OPEN) {
          socketRef.current.send(JSON.stringify({ type: 'input', data }));
        } else {
          queuedInputRef.current.push(data);
          if (statusRef.current === 'disconnected') {
            reconnect();
          }
        }
      });

      // Handle terminal resize events
      term.onResize(({ cols, rows }) => {
        sendResize(cols, rows);
      });

      // Notify parent on native textarea focus
      onTextareaFocus = () => {
        onFocusRef.current?.(id);
      };
      term.textarea?.addEventListener('focus', onTextareaFocus);

      // Set up ResizeObserver
      resizeObserver = new ResizeObserver(() => {
        if (resizeRaf) cancelAnimationFrame(resizeRaf);
        resizeRaf = requestAnimationFrame(() => {
          try {
            if (
              terminalRef.current &&
              terminalRef.current.clientWidth > 0 &&
              terminalRef.current.clientHeight > 0 &&
              fitAddonRef.current
            ) {
              fitAddonRef.current.fit();
            }
          } catch {
            // Ignored
          }
        });
      });

      resizeObserver.observe(terminalRef.current);

      if (isActiveRef.current) {
        requestAnimationFrame(() => {
          term?.focus();
          term?.textarea?.focus();
        });
      }
    } catch (err) {
      console.error('Failed to initialize terminal:', err);
    }

    return () => {
      if (onTextareaFocus) {
        term?.textarea?.removeEventListener('focus', onTextareaFocus);
      }
      if (resizeRaf) {
        cancelAnimationFrame(resizeRaf);
      }
      if (resizeObserver) {
        resizeObserver.disconnect();
      }
      if (term) {
        try {
          term.dispose();
        } catch {
          // Ignore
        }
      }
      xtermInstance.current = null;
      fitAddonRef.current = null;
    };
  }, [sessionId, id, reconnect, sendResize]);

  // 2. WebSocket Connection Lifecycle (Connects / Reconnects on connectKey)
  useEffect(() => {
    if (!sessionId || !id) return;

    let isCleanedUp = false;
    let ws: WebSocket | null = null;

    try {
      const baseUrl = getApiBaseUrl();
      let wsUrl: string;

      if (baseUrl) {
        const urlObj = new URL(baseUrl);
        const wsProtocol = urlObj.protocol === 'https:' ? 'wss:' : 'ws:';
        wsUrl = `${wsProtocol}//${urlObj.host}/api/sessions/${sessionId}/terminal/ws?termId=${id}`;
      } else {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const host = window.location.host;
        wsUrl = `${protocol}//${host}/api/sessions/${sessionId}/terminal/ws?termId=${id}`;
      }

      const token = getAuthToken();
      if (token) {
        wsUrl += `&token=${encodeURIComponent(token)}`;
      }

      const activeWs = new WebSocket(wsUrl);
      ws = activeWs;
      socketRef.current = activeWs;

      activeWs.onopen = () => {
        if (isCleanedUp) return;
        handleStatusUpdate('connected');

        // On reconnection, reset terminal buffer to cleanly receive replayed history/prompt
        if (connectCountRef.current > 0) {
          xtermInstance.current?.reset();
        }
        connectCountRef.current += 1;

        if (fitAddonRef.current && xtermInstance.current) {
          fitAddonRef.current.fit();
          sendResize(xtermInstance.current.cols, xtermInstance.current.rows);
          if (isActiveRef.current) {
            xtermInstance.current.focus();
            xtermInstance.current.textarea?.focus();
          }
        }

        // Flush any queued input that was typed while reconnecting
        if (queuedInputRef.current.length > 0) {
          while (queuedInputRef.current.length > 0) {
            const buffered = queuedInputRef.current.shift();
            if (buffered && activeWs.readyState === WebSocket.OPEN) {
              activeWs.send(JSON.stringify({ type: 'input', data: buffered }));
            }
          }
        }
      };

      activeWs.onmessage = (event) => {
        if (isCleanedUp || !xtermInstance.current) return;
        try {
          const msg = JSON.parse(event.data as string) as {
            type?: string;
            data?: string;
            shell?: string;
            error?: string;
          };

          if (msg.type === 'init' && msg.shell) {
            setShellName(msg.shell);
            onShellChangeRef.current?.(id, msg.shell);
          } else if (msg.type === 'data' && msg.data) {
            xtermInstance.current.write(msg.data);
          } else if (msg.type === 'error' && msg.error) {
            xtermInstance.current.write(`\r\n\x1b[31m[Error] ${msg.error}\x1b[0m\r\n`);
          }
        } catch {
          if (typeof event.data === 'string') {
            xtermInstance.current.write(event.data);
          }
        }
      };

      activeWs.onclose = () => {
        if (!isCleanedUp) {
          handleStatusUpdate('disconnected');
          // Auto-reconnect after 1.5 seconds if not already scheduled
          if (!reconnectTimeoutRef.current) {
            reconnectTimeoutRef.current = setTimeout(() => {
              reconnectTimeoutRef.current = null;
              if (!isCleanedUp) {
                reconnect();
              }
            }, 1500);
          }
        }
      };

      activeWs.onerror = () => {
        if (!isCleanedUp) {
          handleStatusUpdate('disconnected');
        }
      };
    } catch (err) {
      console.error('Failed to establish terminal WebSocket:', err);
    }

    return () => {
      isCleanedUp = true;
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      if (ws) {
        ws.close();
      }
      if (socketRef.current === ws) {
        socketRef.current = null;
      }
    };
  }, [sessionId, id, connectKey, handleStatusUpdate, reconnect, sendResize]);

  // Synchronize dynamic terminal font size and family from settings
  useEffect(() => {
    if (!xtermInstance.current || !codeFont) return;
    if (typeof codeFont.size === 'number' && codeFont.size > 0) {
      xtermInstance.current.options.fontSize = codeFont.size;
    }
    if (codeFont.family) {
      xtermInstance.current.options.fontFamily = `"${codeFont.family}", ${NERD_FONT_FAMILY}`;
    }
    requestAnimationFrame(() => {
      fitAddonRef.current?.fit();
    });
  }, [codeFont?.size, codeFont?.family]);

  // Handle focus updates when active pane changes without reconnecting
  useEffect(() => {
    if (isActive) {
      requestAnimationFrame(() => {
        xtermInstance.current?.focus();
        xtermInstance.current?.textarea?.focus();
      });
    }
  }, [isActive]);

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
