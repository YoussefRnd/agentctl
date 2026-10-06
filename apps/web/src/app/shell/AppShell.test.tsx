import { act, useEffect, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { AppShell } from './AppShell';

vi.mock('./TitleBar', () => ({ TitleBar: () => null }));
vi.mock('./UpdateToast', () => ({ UpdateToast: () => null }));
vi.mock('react-resizable-panels', () => ({
  Group: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Panel: ({
    id,
    children,
    onResize,
  }: {
    id: string;
    children: ReactNode;
    onResize?: (size: { asPercentage: number }, id: string, previousSize: undefined) => void;
  }) => {
    useEffect(() => {
      onResize?.({ asPercentage: 30 }, id, undefined);
    }, [id, onResize]);
    return <div data-panel-id={id}>{children}</div>;
  },
  Separator: () => null,
  usePanelRef: () => ({ current: null }),
  useDefaultLayout: () => ({}),
}));
afterEach(() => vi.restoreAllMocks());

it('removes the desktop sidebar panel on small screens and restores it after resizing', () => {
  const media = {
    matches: false,
    media: '(min-width: 1024px)',
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
  vi.spyOn(window, 'matchMedia').mockReturnValue(media as unknown as MediaQueryList);
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  try {
    act(() =>
      root.render(
        <AppShell nav={null} sidebar={<div>Workspace sidebar</div>}>
          <div>Chat content</div>
        </AppShell>,
      ),
    );
    expect(container.querySelector('[data-panel-id="sidebar"]')).toBeNull();
    expect(container.querySelector('main')?.textContent).toContain('Chat content');
    expect(container.querySelector('aside')?.getAttribute('inert')).not.toBeNull();
    const update = media.addEventListener.mock.calls.find(([event]) => event === 'change')?.[1];
    expect(update).toBeTypeOf('function');
    act(() => {
      media.matches = true;
      update();
    });
    expect(container.querySelector('[data-panel-id="sidebar"]')).not.toBeNull();
    act(() => {
      media.matches = false;
      update();
    });
    expect(container.querySelector('[data-panel-id="sidebar"]')).toBeNull();
  } finally {
    act(() => root.unmount());
    container.remove();
  }
  expect(media.removeEventListener).toHaveBeenCalled();
});

it('keeps the mobile inspector closed after toggling despite panel mount resize callbacks', () => {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  function MobileInspector() {
    const [open, setOpen] = useState(false);
    return (
      <>
        <button onClick={() => setOpen(!open)}>Toggle inspector</button>
        <AppShell
          nav={null}
          aside={<button>Review controls</button>}
          isAsideOpen={open}
          onExpandAside={() => setOpen(true)}
          onCloseAside={() => setOpen(false)}
        >
          <div>Chat content</div>
        </AppShell>
      </>
    );
  }
  try {
    act(() => root.render(<MobileInspector />));
    const toggle = container.querySelector('button')!;
    expect(container.querySelector('main')?.textContent).toContain('Chat content');
    act(() => toggle.click());
    expect(container.querySelector('main')).toBeNull();
    expect(container.textContent).toContain('Review controls');
    expect(container.querySelector('[aria-label="Close aside panel"]')).toBeNull();
    act(() => toggle.click());
    expect(container.querySelector('main')?.textContent).toContain('Chat content');
    expect(container.textContent).not.toContain('Review controls');
    expect(container.querySelector('[data-panel-id="aside"]')).toBeNull();
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});

it('does not reopen a closed inspector when desktop panels remount after resizing', () => {
  const media = {
    matches: true,
    media: '(min-width: 1024px)',
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
  vi.spyOn(window, 'matchMedia').mockReturnValue(media as unknown as MediaQueryList);
  const onExpandAside = vi.fn();
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  try {
    act(() =>
      root.render(
        <AppShell
          nav={null}
          aside={<div>Review controls</div>}
          isAsideOpen={false}
          onExpandAside={onExpandAside}
        >
          <div>Chat content</div>
        </AppShell>,
      ),
    );
    const update = media.addEventListener.mock.calls.find(([event]) => event === 'change')?.[1];
    act(() => {
      media.matches = false;
      update();
    });
    expect(container.querySelector('[data-panel-id="aside"]')).toBeNull();
    act(() => {
      media.matches = true;
      update();
    });
    expect(container.querySelector('[data-panel-id="aside"]')).not.toBeNull();
    expect(onExpandAside).not.toHaveBeenCalled();
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});
