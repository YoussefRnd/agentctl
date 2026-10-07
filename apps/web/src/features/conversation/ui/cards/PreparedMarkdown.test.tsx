// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { prepareMarkdown } from '../../lib/markdownProcessor';
import { PreparedMarkdown } from './PreparedMarkdown';
import { MarkdownCodeBlock } from './MarkdownCodeBlock';
import { MarkdownTable } from './MarkdownTable';

it('matches the full renderer for references, tables, lists, footnotes, code, raw HTML, and URLs', () => {
  const content = `# Unicode 👩🏽‍💻 café العربية 中文

[Reference][target] and footnote[^note].

- [x] Completed
- Nested
  - **bold** and ~~strike~~

| Link | Status |
| --- | --- |
| [Reference][target] | Ready |

\`\`\`typescript
const value = { message: 'hello' };
\`\`\`

\`\`\`unknown-language
plain <code>
\`\`\`

<div onclick="alert(1)">raw HTML</div>

[unsafe](javascript:alert%281%29) ![unsafe image](data:text/html,boom)

[target]: https://example.com/reference
[^note]: Footnote with [link](https://example.com).
`;
  const components = { pre: MarkdownCodeBlock, table: MarkdownTable };
  const standard = document.createElement('div'),
    prepared = document.createElement('div');
  const standardRoot = createRoot(standard),
    preparedRoot = createRoot(prepared);
  act(() => {
    standardRoot.render(
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={components}
      >
        {content}
      </ReactMarkdown>,
    );
    // Simulate the worker's structured clone, rather than sharing the processor tree.
    preparedRoot.render(
      <PreparedMarkdown tree={structuredClone(prepareMarkdown(content))} components={components} />,
    );
  });
  // Footnote ids and controls must stay identical as well as visible text.
  expect(prepared.innerHTML).toBe(standard.innerHTML);
  expect(prepared.querySelector('a')?.getAttribute('href')).toBe('https://example.com/reference');
  expect(prepared.querySelector('.hljs-keyword')?.textContent).toBe('const');
  expect(prepared.querySelector('[onclick]')).toBeNull();
  expect(prepared.querySelector('a[href^="javascript:"]')).toBeNull();
  expect(prepared.querySelector('img[src^="data:"]')).toBeNull();
  act(() => {
    standardRoot.unmount();
    preparedRoot.unmount();
  });
});
