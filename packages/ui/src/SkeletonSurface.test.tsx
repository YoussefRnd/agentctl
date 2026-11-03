import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vite-plus/test';
import { SkeletonSurface } from './components/SkeletonSurface';

let root: Root;
let host: HTMLDivElement;
let frames: Map<number, FrameRequestCallback>;
let resize: ResizeObserverCallback | undefined;
let width: number;
const disconnect = vi.fn();
beforeEach(() => {
  frames = new Map();
  width = 120;
  let id = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++id, callback);
    return id;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: ResizeObserverCallback) {
        resize = callback;
      }
      observe() {}
      disconnect = disconnect;
    },
  );
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement,
  ) {
    return new DOMRect(10, 20, this.dataset.width ? Number(this.dataset.width) : width, 24);
  });
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockImplementation(function (
    this: HTMLElement,
  ) {
    return [this.getBoundingClientRect()] as unknown as DOMRectList;
  });
  // jsdom has no text layout engine; provide line rectangles, not component-specific mocks.
  Object.defineProperty(Range.prototype, 'getClientRects', {
    configurable: true,
    value: () => [new DOMRect(10, 20, 80, 16)],
  });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete (Range.prototype as unknown as { getClientRects?: unknown }).getClientRects;
  disconnect.mockClear();
});
async function flush() {
  await act(async () => {
    await Promise.resolve();
    const pending = [...frames.values()];
    frames.clear();
    pending.forEach((callback) => callback(0));
  });
}
function Example({ extra = false }: { extra?: boolean }) {
  return (
    <section>
      <h2>Preferences</h2>
      <button>Save</button>
      {extra && (
        <section>
          <p>Conditional explanation</p>
          <button data-width="220">New conditional action</button>
        </section>
      )}
    </section>
  );
}
it('derives masks for new controls and conditional sections from the rendered view', async () => {
  act(() =>
    root.render(
      <SkeletonSurface>
        <Example />
      </SkeletonSurface>,
    ),
  );
  const initial = host.querySelectorAll('[data-skeleton-shape]').length;
  expect(initial).toBeGreaterThan(0);
  act(() =>
    root.render(
      <SkeletonSurface>
        <Example extra />
      </SkeletonSurface>,
    ),
  );
  await flush();
  expect(host.querySelectorAll('[data-skeleton-shape]').length).toBe(initial + 2);
  expect(
    [...host.querySelectorAll<HTMLElement>('[data-skeleton-shape]')].some(
      (shape) => shape.style.width === '220px',
    ),
  ).toBe(true);
  act(() =>
    root.render(
      <SkeletonSurface>
        <Example />
      </SkeletonSurface>,
    ),
  );
  await flush();
  expect(host.querySelectorAll('[data-skeleton-shape]')).toHaveLength(initial);
});
it('keeps the same component and DOM state when revealing the live view', () => {
  function Stateful() {
    const [count, setCount] = useState(0);
    return <button onClick={() => setCount(count + 1)}>{count}</button>;
  }
  act(() =>
    root.render(
      <SkeletonSurface pending={false}>
        <Stateful />
      </SkeletonSurface>,
    ),
  );
  const button = host.querySelector('button')!;
  act(() => button.click());
  expect(button.textContent).toBe('1');
  act(() =>
    root.render(
      <SkeletonSurface>
        <Stateful />
      </SkeletonSurface>,
    ),
  );
  expect(button.closest('[inert][aria-hidden="true"]')).not.toBeNull();
  act(() => button.click());
  expect(button.textContent).toBe('1');
  act(() =>
    root.render(
      <SkeletonSurface pending={false}>
        <Stateful />
      </SkeletonSurface>,
    ),
  );
  expect(host.querySelector('button')).toBe(button);
  expect(host.querySelector('[inert]')).toBeNull();
  expect(host.querySelector('[data-skeleton-shape]')).toBeNull();
  act(() => button.click());
  expect(button.textContent).toBe('2');
});
it('remeasures on resize and scroll, and disconnects observers when loading ends', async () => {
  act(() =>
    root.render(
      <SkeletonSurface>
        <button>Save</button>
      </SkeletonSurface>,
    ),
  );
  expect(host.querySelector<HTMLElement>('[data-skeleton-shape]')!.style.width).toBe('120px');
  width = 240;
  resize?.([], {} as ResizeObserver);
  await flush();
  expect(host.querySelector<HTMLElement>('[data-skeleton-shape]')!.style.width).toBe('240px');
  width = 300;
  window.dispatchEvent(new Event('scroll'));
  await flush();
  expect(host.querySelector<HTMLElement>('[data-skeleton-shape]')!.style.width).toBe('300px');
  width = 320;
  document.documentElement.style.setProperty('--font-ui-family', 'monospace');
  await flush();
  expect(host.querySelector<HTMLElement>('[data-skeleton-shape]')!.style.width).toBe('320px');
  document.documentElement.style.removeProperty('--font-ui-family');
  act(() =>
    root.render(
      <SkeletonSurface pending={false}>
        <button>Save</button>
      </SkeletonSurface>,
    ),
  );
  expect(disconnect).toHaveBeenCalled();
  expect(frames.size).toBe(0);
});
it('announces a nested pending tree once and skips invisible controls', () => {
  act(() =>
    root.render(
      <SkeletonSurface message="Loading settings…">
        <button hidden>Hidden</button>
        <SkeletonSurface>
          <button>Save</button>
        </SkeletonSurface>
      </SkeletonSurface>,
    ),
  );
  expect(host.querySelectorAll('[role="status"]')).toHaveLength(1);
  expect(host.querySelector('[role="status"]')!.textContent).toBe('Loading settings…');
  expect(host.querySelectorAll('[data-skeleton-shape]')).toHaveLength(1);
});
it('clips oversized controls and exposes the contents of disclosure rows', () => {
  act(() =>
    root.render(
      <SkeletonSurface>
        <div style={{ overflowX: 'hidden', overflowY: 'hidden' }} data-width="100">
          <button data-width="220">Wide action</button>
        </div>
        <button className="flex-1">
          <span>Disclosure title</span>
        </button>
      </SkeletonSurface>,
    ),
  );
  const widths = [...host.querySelectorAll<HTMLElement>('[data-skeleton-shape]')].map(
    (node) => node.style.width,
  );
  expect(widths).toEqual(['100px', '80px']);
});
