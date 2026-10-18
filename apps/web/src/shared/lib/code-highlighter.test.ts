import { expect, it, vi } from 'vite-plus/test';
import hljs from 'highlight.js';
import { highlightLine } from './code-highlighter';

it('caches syntax work across virtual remounts and renders long generated lines as escaped text', () => {
  const highlight = vi.spyOn(hljs, 'highlight');
  try {
    const code = 'const cachedReviewValue = 123;';
    const html = highlightLine(code, 'typescript');
    expect(html).toContain('hljs');
    expect(highlightLine(code, 'typescript')).toBe(html);
    expect(highlight).toHaveBeenCalledTimes(1);
    const generated = '<script>&'.repeat(10000);
    const plain = highlightLine(generated, 'typescript');
    expect(plain).not.toContain('<script>');
    expect(plain).toBe('&lt;script&gt;&amp;'.repeat(10000));
    expect(highlight).toHaveBeenCalledTimes(1);
  } finally {
    highlight.mockRestore();
  }
});
