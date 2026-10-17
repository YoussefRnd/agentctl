import { useEffect, useRef, useState, useCallback } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { getApiBaseUrl, getDesktopCapability } from '@agentctl/api-client';
import { useFrameScheduler } from '@/shared/hooks/useFrameScheduler';
import type { TerminalPaneProps } from './terminal-types';
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

/** Owns the xterm instance, socket generation, resize/reconnect timers and disposal. */
export function useTerminalPane({
  id,
  sessionId,
  isActive,
  codeFont,
  onFocus,
  onStatusChange,
  onShellChange,
}: TerminalPaneProps) {
  const scheduleFrame = useFrameScheduler(`${sessionId}/${id}`);
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

  // 1. Terminal DOM & Addons Lifecycle (Mounted once per pane)
  useEffect(() => {
    if (!terminalRef.current || !sessionId) return;
    let disposed = false;

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
            if (disposed) return;
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
        scheduleFrame(() => {
          term?.focus();
          term?.textarea?.focus();
        });
      }
    } catch (err) {
      console.error('Failed to initialize terminal:', err);
    }

    return () => {
      disposed = true;
      if (resizeTimerRef.current) {
        clearTimeout(resizeTimerRef.current);
        resizeTimerRef.current = null;
      }
      lastSentCols.current = 0;
      lastSentRows.current = 0;
      queuedInputRef.current = [];
      connectCountRef.current = 0;
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

      const capability = getDesktopCapability();
      const activeWs = capability
        ? new WebSocket(wsUrl, [`agentctl.desktop.${capability}`])
        : new WebSocket(wsUrl);
      ws = activeWs;
      socketRef.current = activeWs;

      activeWs.onopen = () => {
        if (isCleanedUp) return;
        lastSentCols.current = 0;
        lastSentRows.current = 0;
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
    scheduleFrame(() => {
      fitAddonRef.current?.fit();
    });
  }, [codeFont?.size, codeFont?.family]);

  // Handle focus updates when active pane changes without reconnecting
  useEffect(() => {
    if (isActive) {
      scheduleFrame(() => {
        xtermInstance.current?.focus();
        xtermInstance.current?.textarea?.focus();
      });
    }
  }, [isActive]);

  return {
    terminalRef,
    shellName,
    status,
    reconnect,
    handleRestart,
    handleClear,
    handleFocus,
    handleFit,
  };
}
