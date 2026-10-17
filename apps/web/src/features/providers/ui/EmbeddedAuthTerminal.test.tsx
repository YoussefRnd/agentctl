import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, test, vi } from 'vitest';
import { EmbeddedAuthTerminal } from './EmbeddedAuthTerminal';
const terminal = vi.hoisted(() => ({ write: vi.fn(), dispose: vi.fn() }));
vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    write = terminal.write;
    dispose = terminal.dispose;
    loadAddon() {}
    open() {}
    onData() {}
  },
}));
vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class {
    fit() {}
  },
}));
vi.mock('@xterm/addon-web-links', () => ({ WebLinksAddon: class {} }));
vi.mock('@agentctl/api-client', () => ({
  getApiBaseUrl: () => 'https://desktop.local',
  getDesktopCapability: () => 'capability',
}));

test('does not report late auth success or write to a disposed terminal', () => {
  const sockets: Socket[] = [];
  class Socket {
    static OPEN = 1;
    readyState = 1;
    onopen: (() => void) | null = null;
    onmessage: ((event: { data: string }) => void) | null = null;
    close = vi.fn();
    constructor() {
      sockets.push(this);
    }
  }
  vi.stubGlobal('WebSocket', Socket);
  const root = createRoot(document.createElement('div'));
  const success = vi.fn();
  try {
    act(() =>
      root.render(
        <EmbeddedAuthTerminal
          providerId="provider"
          methodId="login"
          onSuccess={success}
          onCancel={vi.fn()}
        />,
      ),
    );
    const socket = sockets[0];
    const lateMessage = socket.onmessage!;
    act(() => root.unmount());
    expect(socket.close).toHaveBeenCalledOnce();
    expect(terminal.dispose).toHaveBeenCalledOnce();
    expect(socket.onmessage).toBeNull();
    lateMessage({ data: JSON.stringify({ type: 'authenticated' }) });
    expect(success).not.toHaveBeenCalled();
    expect(terminal.write).not.toHaveBeenCalled();
  } finally {
    vi.unstubAllGlobals();
  }
});
