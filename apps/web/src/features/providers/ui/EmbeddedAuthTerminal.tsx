import { useRef, useState, useEffect } from 'react';
import { Terminal as TerminalIcon, X } from 'lucide-react';
import { getApiBaseUrl, getDesktopCapability } from '@agentctl/api-client';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';
export function EmbeddedAuthTerminal({
  providerId,
  methodId,
  onSuccess,
  onCancel,
}: {
  providerId: string;
  methodId: string;
  onSuccess: () => void;
  onCancel: () => void;
}) {
  const terminalRef = useRef<HTMLDivElement | null>(null);
  const [exitCode, setExitCode] = useState<number | null>(null);

  useEffect(() => {
    if (!terminalRef.current) return;

    let disposed = false;
    const term = new Terminal({
      cursorBlink: true,
      fontSize: 12,
      fontFamily: 'JetBrains Mono, Menlo, monospace',
      theme: {
        background: '#181825',
        foreground: '#cdd6f4',
      },
      convertEol: true,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(new WebLinksAddon());
    term.open(terminalRef.current);
    fitAddon.fit();

    // Connect WebSocket
    const baseUrl = getApiBaseUrl();
    const url = new URL(baseUrl || window.location.origin);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    url.pathname = `/api/providers/${providerId}/auth/terminal/ws`;
    url.search = new URLSearchParams({ methodId }).toString();
    const capability = getDesktopCapability();
    const ws = capability
      ? new WebSocket(url.toString(), [`agentctl.desktop.${capability}`])
      : new WebSocket(url.toString());

    ws.onopen = () => {
      if (disposed) return;
      term.write('\r\n\x1b[1;34m● Initializing terminal authentication...\x1b[0m\r\n\r\n');
    };

    ws.onmessage = (event) => {
      if (disposed) return;
      try {
        const msg = JSON.parse(event.data as string) as {
          type?: string;
          data?: string;
          code?: number;
          error?: string;
        };
        if (msg.type === 'data' && msg.data) {
          term.write(msg.data);
        } else if (msg.type === 'exit') {
          setExitCode(msg.code ?? 0);
          if (msg.code === 0) {
            term.write('\r\n\x1b[1;32m✓ Authentication succeeded! Verifying...\x1b[0m\r\n');
          } else {
            term.write(`\r\n\x1b[1;31m✗ Process exited with code ${msg.code}\x1b[0m\r\n`);
          }
        } else if (msg.type === 'authenticated') {
          term.write('\r\n\x1b[1;32m✓ Provider connected and verified.\x1b[0m\r\n');
          onSuccess();
        } else if (msg.type === 'error') {
          term.write(`\r\n\x1b[1;31mError: ${msg.error}\x1b[0m\r\n`);
        }
      } catch {
        term.write(String(event.data));
      }
    };

    term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'input', data }));
      }
    });

    return () => {
      disposed = true;
      ws.onopen = null;
      ws.onmessage = null;
      ws.close();
      term.dispose();
    };
  }, [providerId, methodId, onSuccess]);

  return (
    <div className="flex flex-col gap-2">
      <div className="text-text-muted flex items-center justify-between text-[11px]">
        <span className="flex items-center gap-1.5 font-medium">
          <TerminalIcon className="text-accent h-3.5 w-3.5" />
          Interactive Terminal Login
        </span>
        <button
          type="button"
          onClick={onCancel}
          className="text-text-muted hover:text-text-main flex items-center gap-1"
        >
          <X className="h-3.5 w-3.5" />
          Cancel
        </button>
      </div>

      <div
        ref={terminalRef}
        className="border-border/40 h-64 w-full overflow-hidden rounded-xl border bg-[#181825] p-2"
      />

      {exitCode !== null && exitCode !== 0 && (
        <div className="flex items-center justify-between pt-1">
          <span className="text-danger text-[11px]">Process exited with code {exitCode}</span>
          <button
            type="button"
            onClick={onCancel}
            className="border-border/40 text-text-muted hover:text-text-main rounded border px-2.5 py-1 text-[11px]"
          >
            Close
          </button>
        </div>
      )}
    </div>
  );
}
