// @vitest-environment jsdom
import { describe, it, expect } from 'vite-plus/test';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { StreamingMarkdown, getAdaptiveRevealRate, splitGraphemes } from './StreamingMarkdown';
import { splitStreamingContent } from './streamingMarkdownUtils';

describe('splitStreamingContent', () => {
  it('returns single text segment for plain content', () => {
    expect(splitStreamingContent('hello world')).toEqual([
      { key: 'seg-0', type: 'text', value: 'hello world' },
    ]);
  });

  it('splits balanced fences into text/code segments', () => {
    expect(splitStreamingContent('a\n```ts\nx\n```\nb')).toEqual([
      { key: 'seg-0', type: 'text', value: 'a\n' },
      { key: 'seg-2', type: 'code', value: 'x\n' },
      { key: 'seg-7', type: 'text', value: '\nb' },
    ]);
  });

  it('treats unclosed trailing fence as code segment', () => {
    expect(splitStreamingContent('a\n```ts\nx')).toEqual([
      { key: 'seg-0', type: 'text', value: 'a\n' },
      { key: 'seg-2', type: 'code', value: 'x' },
    ]);
  });

  it('strips language tag line from code segments', () => {
    const segments = splitStreamingContent('```ts\nconst a = 1\n```');
    expect(segments[0]).toEqual({ key: 'seg-0', type: 'code', value: 'const a = 1\n' });
  });

  it('keeps long first lines intact', () => {
    const segments = splitStreamingContent('```\nconst long = "line with spaces in it";\n```');
    expect(segments[0]).toEqual({
      key: 'seg-0',
      type: 'code',
      value: 'const long = "line with spaces in it";\n',
    });
  });

  it('splits multi-paragraph text across double newlines for block memoization', () => {
    const segments = splitStreamingContent('Paragraph 1\n\nParagraph 2\n\nParagraph 3');
    expect(segments).toEqual([
      { key: 'seg-0', type: 'text', value: 'Paragraph 1\n\n' },
      { key: 'seg-13', type: 'text', value: 'Paragraph 2\n\n' },
      { key: 'seg-26', type: 'text', value: 'Paragraph 3' },
    ]);
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

  it('stabilizes completed markdown blocks while leaving the active tail lightweight', () => {
    const { container, root } = render('**bold paragraph**\n\nstill streaming', true);
    expect(container.querySelector('strong')?.textContent).toBe('bold paragraph');
    expect(container.textContent).toContain('still streaming');
    expect(container.querySelectorAll('.animate-pulse-block')).toHaveLength(1);
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

  it.each([false, true])(
    'keeps table semantics and links in a focusable region (streaming: %s)',
    (isStreaming) => {
      const { container, root } = render(
        '| File | Status |\n| --- | --- |\n| [composer.tsx](https://example.com/file) | Ready |\n\nNext paragraph',
        isStreaming,
      );
      const region = container.querySelector('[role="region"][aria-label="Scrollable table"]');
      expect(region?.getAttribute('tabindex')).toBe('0');
      expect(region?.querySelectorAll('th')).toHaveLength(2);
      expect(region?.querySelector('td a')?.getAttribute('href')).toBe('https://example.com/file');
      expect(region?.textContent).toContain('Ready');
      act(() => root.unmount());
    },
  );

  it('keeps completed content formatted while removing the active caret immediately', () => {
    const { container, root } = render('**finished**', true);
    act(() => {
      root.render(<StreamingMarkdown content="**finished**" isStreaming={false} />);
    });
    expect(container.querySelector('strong')?.textContent).toBe('finished');
    expect(container.querySelector('.animate-pulse-block')).toBeNull();
    act(() => {
      root.unmount();
    });
  });
});

describe('stream cadence', () => {
  it('keeps emoji and combining marks in one reveal unit', () => {
    expect(splitGraphemes('A👨‍👩‍👧‍👦e\u0301')).toEqual(['A', '👨‍👩‍👧‍👦', 'é']);
  });

  it('tracks provider speed and increases pressure when buffered text grows', () => {
    expect(getAdaptiveRevealRate(100, 0)).toBeCloseTo(115);
    expect(getAdaptiveRevealRate(100, 50)).toBeCloseTo(215);
    expect(getAdaptiveRevealRate(1_000, 500)).toBe(600);
  });
});
