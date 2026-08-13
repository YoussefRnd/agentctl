// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { StreamingMarkdown, splitStreamingContent } from './StreamingMarkdown';

describe('splitStreamingContent', () => {
  it('returns single text segment for plain content', () => {
    expect(splitStreamingContent('hello world')).toEqual([{ type: 'text', value: 'hello world' }]);
  });

  it('splits balanced fences into text/code segments', () => {
    expect(splitStreamingContent('a\n```ts\nx\n```\nb')).toEqual([
      { type: 'text', value: 'a\n' },
      { type: 'code', value: 'x\n' },
      { type: 'text', value: '\nb' },
    ]);
  });

  it('treats unclosed trailing fence as code segment', () => {
    expect(splitStreamingContent('a\n```ts\nx')).toEqual([
      { type: 'text', value: 'a\n' },
      { type: 'code', value: 'x' },
    ]);
  });

  it('strips language tag line from code segments', () => {
    const segments = splitStreamingContent('```ts\nconst a = 1\n```');
    expect(segments[0]).toEqual({ type: 'code', value: 'const a = 1\n' });
  });

  it('keeps long first lines intact', () => {
    const segments = splitStreamingContent('```\nconst long = "line with spaces in it";\n```');
    expect(segments[0]).toEqual({
      type: 'code',
      value: 'const long = "line with spaces in it";\n',
    });
  });
});

describe('StreamingMarkdown', () => {
  function render(content: string, isStreaming: boolean) {
    const container = document.createElement('div');
    const root = createRoot(container);
    act(() => {
      root.render(<StreamingMarkdown content={content} isStreaming={isStreaming} />);
    });
    return { container, root };
  }

  it('renders raw text while streaming', () => {
    const { container, root } = render('**bold** text', true);
    expect(container.querySelector('strong')).toBeNull();
    expect(container.textContent).toContain('**bold**');
    act(() => {
      root.unmount();
    });
  });

  it('renders code fences as pre blocks while streaming', () => {
    const { container, root } = render('```ts\nconst a = 1\n```', true);
    const pre = container.querySelector('pre');
    expect(pre).not.toBeNull();
    expect(pre?.textContent).toContain('const a = 1');
    expect(pre?.textContent).not.toContain('ts');
    act(() => {
      root.unmount();
    });
  });

  it('renders full markdown when complete', () => {
    const { container, root } = render('**bold** text', false);
    expect(container.querySelector('strong')).not.toBeNull();
    act(() => {
      root.unmount();
    });
  });
});
