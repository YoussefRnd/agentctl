import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vite-plus/test';
import { ReviewHeader, type ReviewHeaderProps } from './ReviewHeader';
let root: Root;
afterEach(() => {
  act(() => root?.unmount());
  document.body.innerHTML = '';
});
it('shares the segmented filter, keeps compact text and counts, and resets a repeated selection', () => {
  const change = vi.fn();
  const props: ReviewHeaderProps = {
    files: [
      { path: 'a.ts', state: 'modified' },
      { path: 'b.ts', state: 'staged' },
    ] as ReviewHeaderProps['files'],
    scope: 'uncommitted',
    onScopeChange: vi.fn(),
    scopeCounts: { uncommitted: 2, this_turn: 0, all_edits: 2 },
    viewMode: 'inline',
    wrapLines: false,
    onToggleWrapLines: vi.fn(),
    onToggleViewMode: vi.fn(),
    searchQuery: '',
    onSearchChange: vi.fn(),
    allCollapsed: false,
    onToggleAll: vi.fn(),
    statusFilter: 'modified',
    onStatusFilterChange: change,
  };
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() => root.render(<ReviewHeader {...props} />));
  const group = host.querySelector('[aria-label="Filter changed files"]')!;
  expect(group.getAttribute('data-slot')).toBe('segmented-control');
  const buttons = group.querySelectorAll<HTMLButtonElement>('button');
  expect(buttons).toHaveLength(3);
  expect(buttons[0]!.textContent).toBe('All2');
  expect(buttons[1]!.className.split(' ')).toEqual(
    expect.arrayContaining(['text-[10px]', 'h-5', 'py-0']),
  );
  act(() => buttons[1]!.click());
  expect(change).toHaveBeenLastCalledWith('all');
  act(() => buttons[2]!.click());
  expect(change).toHaveBeenLastCalledWith('staged');
});
