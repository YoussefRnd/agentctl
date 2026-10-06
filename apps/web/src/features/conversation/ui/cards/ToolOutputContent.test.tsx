import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'vitest';
import { ToolDiffBlock, ToolOutput } from './ToolOutputContent';

test('keeps output keyboard accessible and actions outside the scrolling text', () => {
  const container = document.createElement('div');
  container.innerHTML = renderToStaticMarkup(
    <ToolOutput action={<button type="button">Copy</button>}>
      {'  preserved\n    indentation'}
    </ToolOutput>,
  );
  const output = container.querySelector('[role="region"]')!;
  expect(output.getAttribute('aria-label')).toBe('Tool output');
  expect(output.getAttribute('tabindex')).toBe('0');
  expect(output.textContent).toBe('  preserved\n    indentation');
  expect(output.contains(container.querySelector('button'))).toBe(false);
});

test('renders the structured change list and supplied patch safely', () => {
  const markup = renderToStaticMarkup(
    <ToolDiffBlock
      block={{
        type: 'diff',
        changes: [{ operation: 'modify', path: '/workspace/config.json', fileType: 'text' }],
        patch: {
          format: 'git_patch',
          text: 'diff --git /workspace/config.json /workspace/config.json\n@@ -1 +1 @@\n-before\n+<script>after</script>',
        },
      }}
    />,
  );
  expect(markup).toContain('/workspace/config.json');
  expect(markup).toContain('aria-label="Diff patch"');
  expect(markup).toContain('-before');
  expect(markup).toContain('+&lt;script&gt;after&lt;/script&gt;');
  expect(markup).not.toContain('<script>');
});

test('shows binary, symlink, directory, and move changes without requiring a patch', () => {
  const markup = renderToStaticMarkup(
    <ToolDiffBlock
      block={{
        changes: [
          { operation: 'delete', path: '/binary', fileType: 'binary' },
          { operation: 'modify', path: '/link', fileType: 'symlink' },
          { operation: 'move', oldPath: '/old', path: '/new', fileType: 'directory' },
        ],
        patch: null,
      }}
    />,
  );
  for (const value of [
    'Delete',
    '/binary',
    'binary',
    '/link',
    'symlink',
    '/old',
    '/new',
    'directory',
    'No text patch',
  ])
    expect(markup.toLowerCase()).toContain(value.toLowerCase());
  expect(markup).not.toContain('aria-label="Diff patch"');
});

test('retains the v1 diff display and handles unfamiliar patch formats', () => {
  expect(
    renderToStaticMarkup(
      <ToolDiffBlock block={{ path: '/file', oldText: 'before', newText: 'after' }} />,
    ),
  ).toContain('+ after');
  expect(
    renderToStaticMarkup(
      <ToolDiffBlock
        block={{
          changes: [{ operation: 'future_op', path: '/file' }],
          patch: { format: 'future_patch', text: 'opaque' },
        }}
      />,
    ),
  ).toContain('Patch format future_patch is not supported.');
});
