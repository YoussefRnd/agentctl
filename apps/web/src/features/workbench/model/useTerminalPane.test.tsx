import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, test, vi } from 'vite-plus/test';
import { useTerminalPane } from './useTerminalPane';

type MockTerminal = {
  dispose: ReturnType<typeof vi.fn>;
  write: ReturnType<typeof vi.fn>;
  reset: ReturnType<typeof vi.fn>;
};
const state = vi.hoisted(() => ({ terminals: [] as MockTerminal[], sockets: [] as Socket[] }));
vi.mock('@agentctl/api-client', () => ({
  getApiBaseUrl: () => 'https://desktop.local',
  getDesktopCapability: () => 'capability',
}));
vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    cols = 80;
    rows = 24;
    options = {};
    textarea = document.createElement('textarea');
    dispose = vi.fn();
    write = vi.fn();
    reset = vi.fn();
    focus = vi.fn();
    clear = vi.fn();
    onData = vi.fn();
    onResize = vi.fn();
    loadAddon() {}
    attachCustomKeyEventHandler() {}
    open() {}
    constructor() {
      state.terminals.push(this);
    }
  },
}));
vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class {
    fit() {}
  },
}));
vi.mock('@xterm/addon-web-links', () => ({ WebLinksAddon: class {} }));

class Socket {
  static OPEN = 1;
  readyState = 1;
  onopen?: () => void;
  onmessage?: (event: { data: string }) => void;
  onclose?: () => void;
  onerror?: () => void;
  send = vi.fn();
  close = vi.fn();
  constructor(
    readonly url: string,
    readonly protocols?: string[],
  ) {
    state.sockets.push(this);
  }
}
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  state.terminals = [];
  state.sockets = [];
});

test('reconnects with fresh dimensions and disposes socket, observer and queued DOM work', () => {
  vi.useFakeTimers();
  vi.stubGlobal('WebSocket', Socket);
  const disconnect = vi.fn();
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect = disconnect;
    },
  );
  const frames = new Map<number, FrameRequestCallback>();
  let sequence = 0;
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    frames.set(++sequence, cb);
    return sequence;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  function Harness() {
    const pane = useTerminalPane({
      id: 'pane',
      name: 'Terminal',
      sessionId: 'session',
      isActive: true,
      isSplit: false,
      onFocus: vi.fn(),
      codeFont: { size: 14 },
    });
    return <div ref={pane.terminalRef} />;
  }
  const container = document.createElement('div');
  const root = createRoot(container);
  try {
    act(() => root.render(<Harness />));
    const first = state.sockets[0] as Socket;
    const terminal = state.terminals[0];
    expect(first.url).toBe('wss://desktop.local/api/sessions/session/terminal/ws?termId=pane');
    expect(first.protocols).toEqual(['agentctl.desktop.capability']);
    act(() => {
      first.onopen!();
      vi.advanceTimersByTime(60);
    });
    expect(first.send).toHaveBeenCalledWith(JSON.stringify({ type: 'resize', cols: 80, rows: 24 }));
    act(() => {
      first.onclose!();
      vi.advanceTimersByTime(1500);
    });
    const second = state.sockets[1] as Socket;
    act(() => {
      second.onopen!();
      vi.advanceTimersByTime(60);
    });
    expect(second.send).toHaveBeenCalledWith(
      JSON.stringify({ type: 'resize', cols: 80, rows: 24 }),
    );
    expect(terminal.reset).toHaveBeenCalledOnce();
    const lateMessage = second.onmessage!;
    act(() => second.onclose!());
    expect(frames.size).toBeGreaterThan(0);
    act(() => root.unmount());
    expect(terminal.dispose).toHaveBeenCalledOnce();
    expect(first.close).toHaveBeenCalledOnce();
    expect(second.close).toHaveBeenCalledOnce();
    expect(disconnect).toHaveBeenCalledOnce();
    expect(frames.size).toBe(0);
    act(() => {
      vi.runAllTimers();
      lateMessage({ data: JSON.stringify({ type: 'data', data: 'stale' }) });
    });
    expect(state.sockets).toHaveLength(2);
    expect(terminal.write).not.toHaveBeenCalled();
  } finally {
    container.remove();
  }
});
