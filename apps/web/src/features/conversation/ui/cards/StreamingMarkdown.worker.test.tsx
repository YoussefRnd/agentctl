// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'hast';
import { prepareMarkdown } from '../../lib/markdownProcessor';
import { StreamingMarkdown } from './StreamingMarkdown';

const jobs = vi.hoisted(
  () =>
    [] as {
      content: string;
      listener: (tree: Root | null) => void;
      unsubscribe: ReturnType<typeof vi.fn>;
    }[],
);
vi.mock('../../lib/markdownWorker', () => ({
  subscribeMarkdown: (content: string, listener: (tree: Root | null) => void) => {
    const unsubscribe = vi.fn();
    jobs.push({ content, listener, unsubscribe });
    return unsubscribe;
  },
}));
afterEach(() => {
  jobs.length = 0;
  vi.unstubAllGlobals();
});
const long = (tail: string) =>
  '**stable**\n\n' + 'plain paragraph\n\n'.repeat(500) + '```text\nplain\n```\n\n' + tail;

it('reuses completed blocks while preparing, then renders full-document references and highlighting', () => {
  vi.stubGlobal('Worker', function Worker() {});
  const container = document.createElement('div'),
    root = createRoot(container);
  const content = long(
    '[link][ref]\n\n```typescript\nconst answer = 42;\n```\n\n[ref]: https://example.com',
  );
  act(() => root.render(<StreamingMarkdown content={content} isStreaming />));
  const stable = container.querySelector('strong');
  act(() => root.render(<StreamingMarkdown content={content} />));
  expect(container.querySelector('strong')).toBe(stable);
  expect(container.querySelector('.animate-pulse-block')).toBeNull();
  expect(
    container.querySelector('[data-markdown-state]')?.getAttribute('data-markdown-state'),
  ).toBe('preparing');
  act(() => jobs[0].listener(prepareMarkdown(content)));
  expect(container.querySelector('a')?.getAttribute('href')).toBe('https://example.com');
  expect(container.querySelector('.hljs-keyword')?.textContent).toBe('const');
  expect(
    container.querySelector('[data-markdown-state]')?.getAttribute('data-markdown-state'),
  ).toBe('complete');
  act(() => root.unmount());
  expect(jobs[0].unsubscribe).toHaveBeenCalledOnce();
});

it('ignores results for replaced, resumed, and unmounted replies', () => {
  vi.stubGlobal('Worker', function Worker() {});
  const container = document.createElement('div'),
    root = createRoot(container);
  act(() => root.render(<StreamingMarkdown content={long('old')} />));
  const old = jobs[0];
  act(() => root.render(<StreamingMarkdown content={long('new')} />));
  expect(old.unsubscribe).toHaveBeenCalledOnce();
  act(() => old.listener(prepareMarkdown('STALE')));
  expect(container.textContent).not.toContain('STALE');
  const current = jobs[1];
  act(() => root.render(<StreamingMarkdown content={long('new')} isStreaming />));
  act(() => current.listener(prepareMarkdown('STALE')));
  expect(container.querySelector('.animate-pulse-block')).not.toBeNull();
  act(() => root.unmount());
  act(() => current.listener(prepareMarkdown('STALE')));
  expect(container.textContent).toBe('');
});

it('falls back to the full renderer on worker failure and leaves short replies synchronous', () => {
  vi.stubGlobal('Worker', function Worker() {});
  const container = document.createElement('div'),
    root = createRoot(container);
  const content = long('[link][ref]\n\n[ref]: https://example.com');
  act(() => root.render(<StreamingMarkdown content={content} />));
  act(() => jobs[0].listener(null));
  expect(container.querySelector('a')?.getAttribute('href')).toBe('https://example.com');
  expect(
    container.querySelector('[data-markdown-state]')?.getAttribute('data-markdown-state'),
  ).toBe('complete');
  act(() => root.render(<StreamingMarkdown content="**short**" />));
  expect(jobs).toHaveLength(1);
  expect(container.querySelector('strong')?.textContent).toBe('short');
  act(() => root.unmount());
});
