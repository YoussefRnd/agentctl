import { useEffect, useRef, useState, useCallback } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { CanvasAddon } from '@xterm/addon-canvas';
import '@xterm/xterm/css/xterm.css';
import { getApiBaseUrl } from '../../../../shared/lib/api-base-url';
import { useSession } from '../../../../contexts/SessionContext';
import { RotateCcw, Trash2 } from 'lucide-react';
import { Button } from '@agentctl/ui';

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

export function InteractiveTerminal() {
  const { sessionId } = useSession();
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermInstance = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const [shellName, setShellName] = useState<string>('sh');
  const [status, setStatus] = useState<'connecting' | 'connected' | 'disconnected'>('connecting');

  const sendResize = useCallback((cols: number, rows: number) => {
    if (socketRef.current?.readyState === WebSocket.OPEN && cols > 0 && rows > 0) {
      socketRef.current.send(JSON.stringify({ type: 'resize', cols, rows }));
    }
  }, []);

  const connect = useCallback(() => {
    if (!sessionId) return;

    if (socketRef.current) {
      socketRef.current.close();
      socketRef.current = null;
    }

    setStatus('connecting');

    const baseUrl = getApiBaseUrl();
    let wsUrl: string;

    if (baseUrl) {
      const urlObj = new URL(baseUrl);
      const wsProtocol = urlObj.protocol === 'https:' ? 'wss:' : 'ws:';
      wsUrl = `${wsProtocol}//${urlObj.host}/api/sessions/${sessionId}/terminal/ws`;
    } else {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const host =
        window.location.port === '5173' || window.location.port === '5174'
          ? 'localhost:3000'
          : window.location.host;
      wsUrl = `${protocol}//${host}/api/sessions/${sessionId}/terminal/ws`;
    }

    const token = localStorage.getItem('agentctl_token');
    if (token) {
      wsUrl += `?token=${encodeURIComponent(token)}`;
    }

    try {
      const ws = new WebSocket(wsUrl);
      socketRef.current = ws;

      ws.onopen = () => {
        setStatus('connected');
        if (xtermInstance.current && fitAddonRef.current) {
          fitAddonRef.current.fit();
          xtermInstance.current.focus();
          sendResize(xtermInstance.current.cols, xtermInstance.current.rows);
        }
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data as string) as {
            type?: string;
            data?: string;
            shell?: string;
            error?: string;
          };

          if (msg.type === 'init' && msg.shell) {
            setShellName(msg.shell);
          } else if (msg.type === 'data' && msg.data) {
            xtermInstance.current?.write(msg.data);
          } else if (msg.type === 'error' && msg.error) {
            xtermInstance.current?.write(`\r\n\x1b[31m[Error] ${msg.error}\x1b[0m\r\n`);
          }
        } catch {
          if (typeof event.data === 'string') {
            xtermInstance.current?.write(event.data);
          }
        }
      };

      ws.onclose = () => {
        setStatus('disconnected');
      };

      ws.onerror = () => {
        setStatus('disconnected');
      };
    } catch {
      setStatus('disconnected');
    }
  }, [sessionId, sendResize]);

  useEffect(() => {
    if (!terminalRef.current) return;

    let term: Terminal | null = null;
    let fitAddon: FitAddon | null = null;
    let canvasAddon: CanvasAddon | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let resizeRaf: number | null = null;

    try {
      term = new Terminal({
        cursorBlink: true,
        cursorStyle: 'block',
        cursorInactiveStyle: 'outline',
        fontSize: 12.5,
        fontFamily: NERD_FONT_FAMILY,
        letterSpacing: 0,
        lineHeight: 1.2,
        scrollback: 10000,
        smoothScrollDuration: 100, // VS Code fluid smooth pixel scrolling
        allowTransparency: true,
        macOptionIsMeta: true,
        altClickMovesCursor: true,
        drawBoldTextInBrightColors: true,
        theme: {
          background: '#090a0f',
          foreground: '#e2e8f0',
          cursor: '#a855f7',
          cursorAccent: '#ffffff',
          selectionBackground: 'rgba(168, 85, 247, 0.35)',
          black: '#1e2029',
          red: '#f87171',
          green: '#4ade80',
          yellow: '#facc15',
          blue: '#60a5fa',
          magenta: '#c084fc',
          cyan: '#38bdf8',
          white: '#f8fafc',
          brightBlack: '#64748b',
          brightRed: '#ef4444',
          brightGreen: '#22c55e',
          brightYellow: '#eab308',
          brightBlue: '#3b82f6',
          brightMagenta: '#a855f7',
          brightCyan: '#06b6d4',
          brightWhite: '#ffffff',
        },
      });

      fitAddon = new FitAddon();
      const webLinksAddon = new WebLinksAddon();

      term.loadAddon(fitAddon);
      term.loadAddon(webLinksAddon);

      term.open(terminalRef.current);

      // Hardware accelerated GPU canvas glyph atlas
      try {
        canvasAddon = new CanvasAddon();
        term.loadAddon(canvasAddon);
      } catch {
        // Graceful fallback to DOM renderer
      }

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
            return false; // Prevent sending \x03 to shell
          }
        }

        // Paste with Ctrl+V / Cmd+V
        if (isCtrlOrCmd && event.key.toLowerCase() === 'v' && event.type === 'keydown') {
          void navigator.clipboard.readText().then((text) => {
            if (text && socketRef.current?.readyState === WebSocket.OPEN) {
              socketRef.current.send(JSON.stringify({ type: 'input', data: text }));
            }
          });
          return false;
        }

        return true;
      });

      term.onData((data) => {
        if (socketRef.current?.readyState === WebSocket.OPEN) {
          socketRef.current.send(JSON.stringify({ type: 'input', data }));
        }
      });

      term.onResize(({ cols, rows }) => {
        sendResize(cols, rows);
      });

      resizeObserver = new ResizeObserver(() => {
        if (resizeRaf) cancelAnimationFrame(resizeRaf);
        resizeRaf = requestAnimationFrame(() => {
          try {
            if (
              terminalRef.current &&
              terminalRef.current.clientWidth > 0 &&
              terminalRef.current.clientHeight > 0 &&
              fitAddonRef.current &&
              xtermInstance.current
            ) {
              fitAddonRef.current.fit();
              sendResize(xtermInstance.current.cols, xtermInstance.current.rows);
            }
          } catch {
            // Ignored
          }
        });
      });

      resizeObserver.observe(terminalRef.current);
      connect();
    } catch (err) {
      console.error('Failed to initialize xterm:', err);
    }

    return () => {
      if (resizeRaf) {
        cancelAnimationFrame(resizeRaf);
      }
      if (resizeObserver) {
        resizeObserver.disconnect();
      }
      if (canvasAddon) {
        try {
          canvasAddon.dispose();
        } catch {
          // Ignore
        }
      }
      if (term) {
        try {
          term.dispose();
        } catch {
          // Ignore disposal errors
        }
      }
      xtermInstance.current = null;
      fitAddonRef.current = null;
      if (socketRef.current) {
        socketRef.current.close();
        socketRef.current = null;
      }
    };
  }, [connect, sendResize]);

  const handleRestart = () => {
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({ type: 'restart' }));
    } else {
      connect();
    }
  };

  const handleClear = () => {
    xtermInstance.current?.clear();
  };

  return (
    <div className="flex h-full min-w-0 flex-col bg-[#090a0f]">
      {/* Sleek Minimal Top Bar */}
      <div className="border-border/20 bg-surface-secondary/15 flex h-8 shrink-0 items-center justify-between border-b px-2.5 text-xs">
        {/* Left: Shell Badge + Subtle Dot */}
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5">
            <span
              className={`h-1.5 w-1.5 rounded-full transition-all duration-300 ${
                status === 'connected'
                  ? 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.7)]'
                  : status === 'connecting'
                    ? 'animate-pulse bg-amber-400'
                    : 'bg-rose-500'
              }`}
              title={
                status === 'connected'
                  ? 'Connected'
                  : status === 'connecting'
                    ? 'Connecting...'
                    : 'Disconnected'
              }
            />
            <span className="text-text-muted/80 font-mono text-[11px] font-medium tracking-tight">
              {shellName}
            </span>
          </div>

          {status === 'disconnected' && (
            <span className="text-[10px] font-medium text-rose-400 opacity-80">(Disconnected)</span>
          )}
        </div>

        {/* Right: Minimal Icon Actions */}
        <div className="flex items-center gap-1">
          {status === 'disconnected' && (
            <Button
              variant="outline"
              size="sm"
              onClick={connect}
              className="!h-5 !px-2 text-[10px]"
            >
              Reconnect
            </Button>
          )}
          <button
            type="button"
            onClick={handleRestart}
            title="Restart shell process"
            className="text-text-muted/60 hover:text-text-main hover:bg-surface-tertiary/30 flex h-5.5 w-5.5 items-center justify-center rounded transition-colors"
            aria-label="Restart shell"
          >
            <RotateCcw className="h-3 w-3" />
          </button>
          <button
            type="button"
            onClick={handleClear}
            title="Clear scrollback"
            className="text-text-muted/60 hover:text-text-main hover:bg-surface-tertiary/30 flex h-5.5 w-5.5 items-center justify-center rounded transition-colors"
            aria-label="Clear terminal"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      </div>

      {/* Terminal View Container */}
      <div
        className="relative min-h-0 flex-1 cursor-text p-2"
        onClick={() => xtermInstance.current?.focus()}
      >
        <div ref={terminalRef} className="h-full w-full overflow-hidden font-mono" />
      </div>
    </div>
  );
}
