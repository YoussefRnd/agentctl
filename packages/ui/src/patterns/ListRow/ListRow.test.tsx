// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { ListRow } from './ListRow.js';

afterEach(() => {
  document.body.innerHTML = '';
});

describe('ListRow', () => {
  it('renders title and subtitle correctly', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    act(() => {
      root.render(<ListRow title="Project Alpha" subtitle="/path/to/project" />);
    });

    expect(container.textContent).toContain('Project Alpha');
    expect(container.textContent).toContain('/path/to/project');
  });

  it('renders an anchor with href when href is passed', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    act(() => {
      root.render(<ListRow title="Link Item" href="/test-path" />);
    });

    const link = container.querySelector('a');
    expect(link).not.toBeNull();
    expect(link?.getAttribute('href')).toBe('/test-path');
  });

  it('handles click event when onClick is provided', () => {
    const handleClick = vi.fn();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    act(() => {
      root.render(<ListRow title="Button Item" onClick={handleClick} />);
    });

    const button = container.querySelector('button');
    expect(button).not.toBeNull();
    act(() => {
      button?.click();
    });
    expect(handleClick).toHaveBeenCalledTimes(1);
  });
});
