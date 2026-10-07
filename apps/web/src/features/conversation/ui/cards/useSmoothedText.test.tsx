// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { useSmoothedText } from './StreamingMarkdown';

function fixture(reducedMotion = false) {
  vi.spyOn(performance, 'now').mockReturnValue(0);
  const frames = new Map<number, FrameRequestCallback>();
  let id = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++id, callback);
    return id;
  });
  vi.stubGlobal('cancelAnimationFrame', (frame: number) => frames.delete(frame));
  const preference = Object.assign(new EventTarget(), { matches: reducedMotion });
  vi.stubGlobal('matchMedia', () => preference);
  const container = document.createElement('div'),
    root = createRoot(container);
  function Probe({ content, streaming }: { content: string; streaming: boolean }) {
    return <span>{useSmoothedText(content, streaming)}</span>;
  }
  const render = (content: string, streaming = true) =>
    act(() => root.render(<Probe content={content} streaming={streaming} />));
  const frame = () =>
    act(() => {
      const pending = [...frames.values()];
      frames.clear();
      pending.forEach((callback) => callback(16));
    });
  return { frames, preference, container, root, render, frame };
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it('reveals whole graphemes, discards replaced backlogs, flushes completion, and cancels on unmount', () => {
  const { render, frame, container, root, frames } = fixture();
  render('A');
  render('A👩🏽‍💻BC');
  expect(container.textContent).toBe('A');
  frame();
  expect(container.textContent).toBe('A👩🏽‍💻');
  render('replacement');
  frame();
  expect(container.textContent).toBe('replacement');
  render('replacement pending');
  render('replacement final', false);
  expect(container.textContent).toBe('replacement final');
  expect(frames.size).toBe(0);
  render('replacement final more');
  expect(frames.size).toBe(1);
  act(() => root.unmount());
  expect(frames.size).toBe(0);
});

it('flushes a backlog when reduced motion is enabled and applies future chunks immediately', () => {
  const { render, container, root, frames, preference } = fixture();
  render('A');
  render('A buffered');
  expect(container.textContent).toBe('A');
  act(() => {
    preference.matches = true;
    preference.dispatchEvent(new Event('change'));
  });
  expect(container.textContent).toBe('A buffered');
  expect(frames.size).toBe(0);
  render('A buffered 👩🏽‍💻');
  expect(container.textContent).toBe('A buffered 👩🏽‍💻');
  act(() => root.unmount());
});
