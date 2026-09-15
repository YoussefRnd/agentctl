import { useEffect, useRef, useState, useCallback } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { CanvasAddon } from '@xterm/addon-canvas';
import '@xterm/xterm/css/xterm.css';
import { getApiBaseUrl } from '@/shared/lib/api-base-url';
import { getAuthToken } from '@agentctl/api-client';
import { useSession } from '@/features/sessions';
import { useSettings } from '@/features/settings';
import { TerminalHeader, type TerminalTabItem } from './TerminalHeader';

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
  const { settings } = useSettings();
  const codeFont = settings?.fontConfig?.code;

  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermInstance = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const socketRef = useRef<WebSocket | null>(null);

  const [tabs, setTabs] = useState<TerminalTabItem[]>([{ id: '1', name: 'Terminal 1' }]);
  const [activeTabId, setActiveTabId] = useState<string>('1');

  const [shellName, setShellName] = useState<string>('sh');
  const [status, setStatus] = useState<'connecting' | 'connected' | 'disconnected'>('connecting');

  const [connectKey, setConnectKey] = useState<number>(0);
  const reconnect = useCallback(() => {
    setStatus('connecting');
    setConnectKey((k) => k + 1);
  }, []);

  const sendResize = useCallback((cols: number, rows: number) => {
    if (socketRef.current?.readyState === WebSocket.OPEN && cols > 0 && rows > 0) {
      socketRef.current.send(JSON.stringify({ type: 'resize', cols, rows }));
    }
  }, []);

  const handleAddTab = useCallback(() => {
    setTabs((prev) => {
      const nextNum = prev.length + 1;
      const newId = String(Date.now());
      const newTab = { id: newId, name: `Terminal ${String(nextNum)}` };
      setActiveTabId(newId);
      return [...prev, newTab];
    });
  }, []);

  const handleCloseTab = useCallback(
    (idToClose: string) => {
      setTabs((prev) => {
        if (prev.length <= 1) return prev;
        const filtered = prev.filter((t) => t.id !== idToClose);
        if (activeTabId === idToClose) {
          const nextActive = filtered[filtered.length - 1]?.id ?? '1';
          setActiveTabId(nextActive);
        }
        return filtered;
      });
    },
    [activeTabId],
  );

  const handleRenameTab = useCallback((id: string, newName: string) => {
    setTabs((prev) => prev.map((t) => (t.id === id ? { ...t, name: newName } : t)));
  }, []);

  // WebSocket connection management for the active tab
  useEffect(() => {
    if (!sessionId) return;

    const baseUrl = getApiBaseUrl();
    let wsUrl: string;

    if (baseUrl) {
      const urlObj = new URL(baseUrl);
      const wsProtocol = urlObj.protocol === 'https:' ? 'wss:' : 'ws:';
      wsUrl = `${wsProtocol}//${urlObj.host}/api/sessions/${sessionId}/terminal/ws?termId=${activeTabId}`;
    } else {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const host = window.location.host;
      wsUrl = `${protocol}//${host}/api/sessions/${sessionId}/terminal/ws?termId=${activeTabId}`;
    }

    const token = getAuthToken();
    if (token) {
      wsUrl += `&token=${encodeURIComponent(token)}`;
    }

    let ws: WebSocket | null = null;
    xtermInstance.current?.clear();

    try {
      ws = new WebSocket(wsUrl);
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
      queueMicrotask(() => {
        setStatus('disconnected');
      });
    }

    return () => {
      if (ws) {
        ws.close();
      }
      if (socketRef.current === ws) {
        socketRef.current = null;
      }
    };
  }, [sessionId, activeTabId, connectKey, sendResize]);

  // Terminal lifecycle & xterm initialization
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
        fontSize: codeFont?.size ?? 13,
        lineHeight: 1.25,
        fontFamily: codeFont?.family
          ? `"${codeFont.family}", ${NERD_FONT_FAMILY}`
          : NERD_FONT_FAMILY,
        theme: {
          background: '#090a0f',
          foreground: '#cdd6f4',
          cursor: '#f5e0dc',
          cursorAccent: '#11111b',
          selectionBackground: '#45475a',
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
        scrollback: 5000,
      });

      fitAddon = new FitAddon();
      term.loadAddon(fitAddon);
      term.loadAddon(new WebLinksAddon());

      term.open(terminalRef.current);

      try {
        canvasAddon = new CanvasAddon();
        term.loadAddon(canvasAddon);
      } catch {
        // Fallback to standard DOM renderer
      }

      xtermInstance.current = term;
      fitAddonRef.current = fitAddon;

      term.onData((data) => {
        if (socketRef.current?.readyState === WebSocket.OPEN) {
          socketRef.current.send(JSON.stringify({ type: 'input', data }));
        }
      });

      term.onResize(({ cols, rows }) => {
        sendResize(cols, rows);
      });

      requestAnimationFrame(() => {
        fitAddon?.fit();
        if (term) {
          term.focus();
          sendResize(term.cols, term.rows);
        }
      });

      resizeObserver = new ResizeObserver(() => {
        if (resizeRaf) {
          cancelAnimationFrame(resizeRaf);
        }
        resizeRaf = requestAnimationFrame(() => {
          try {
            if (fitAddonRef.current && xtermInstance.current) {
              fitAddonRef.current.fit();
              sendResize(xtermInstance.current.cols, xtermInstance.current.rows);
            }
          } catch {
            // Ignored
          }
        });
      });

      resizeObserver.observe(terminalRef.current);
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
    };
  }, [codeFont?.family, codeFont?.size, sendResize]);

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
      try {
        if (fitAddonRef.current && xtermInstance.current) {
          fitAddonRef.current.fit();
          sendResize(xtermInstance.current.cols, xtermInstance.current.rows);
        }
      } catch {
        // ignore
      }
    });
  }, [codeFont?.size, codeFont?.family, sendResize]);

  const handleRestart = () => {
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({ type: 'restart' }));
    } else {
      reconnect();
    }
  };

  const handleClear = () => {
    xtermInstance.current?.clear();
  };

  return (
    <div data-font-ctx="terminal" className="flex h-full min-w-0 flex-col bg-[#090a0f]">
      <TerminalHeader
        tabs={tabs}
        activeTabId={activeTabId}
        onSelectTab={setActiveTabId}
        onAddTab={handleAddTab}
        onCloseTab={handleCloseTab}
        onRenameTab={handleRenameTab}
        status={status}
        shellName={shellName}
        reconnect={reconnect}
        handleRestart={handleRestart}
        handleClear={handleClear}
      />

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
