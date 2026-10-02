import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ReviewFileList } from './ReviewFileList';
import { parseDiff } from '@/shared/lib/diff-parser';
import type { ReviewFile } from './ReviewHeader';

const composer = vi.hoisted(() => ({
  attachContextToComposer: vi.fn(),
  insertIntoComposer: vi.fn(),
}));
vi.mock('@/features/composer', () => ({ useDraftStore: { getState: () => composer } }));
vi.mock('sonner', () => ({ toast: { success: vi.fn() } }));

const roots: Root[] = [];
afterEach(() => {
  act(() => roots.splice(0).forEach((root) => root.unmount()));
  document.body.innerHTML = '';
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

function renderFile(overrides: Partial<ReviewFile> = {}) {
  const path = 'terraform-examples/terraform.tfvars.example';
  const diff = '@@ -1,1 +1,1 @@\n-old\n+new\n@@ -5,1 +5,1 @@\n-other\n+updated';
  const file: ReviewFile = { path, diff, state: 'modified', ...overrides };
  const actions = {
    onStage: vi.fn(),
    onUnstage: vi.fn(),
    onRevert: vi.fn(),
    onOpenFile: vi.fn(),
    onToggleFile: vi.fn(),
  };
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(
      <ReviewFileList
        files={[{ ...file, hunks: parseDiff(diff) }]}
        collapsedFiles={{ [path]: false }}
        fileStats={new Map()}
        viewMode="inline"
        {...actions}
      />,
    ),
  );
  const openMenu = () =>
    act(() => {
      container
        .querySelector<HTMLButtonElement>('[aria-label^="More actions"]')
        ?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
  const select = (text: string) =>
    act(() => {
      Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]'))
        .find((item) => item.textContent?.includes(text))
        ?.click();
    });
  return { container, file, actions, openMenu, select };
}

describe('review file actions', () => {
  it('stages a file once and keeps hunk quoting separate from staging', () => {
    const { container, file, actions } = renderFile();
    const stage = container.querySelector<HTMLButtonElement>('[aria-label="Stage file"]');
    expect(
      Array.from(container.querySelectorAll('button')).filter((button) =>
        button.textContent?.includes('Stage'),
      ),
    ).toHaveLength(1);
    act(() => stage?.click());
    expect(actions.onStage).toHaveBeenCalledExactlyOnceWith(file.path);
    act(() =>
      Array.from(container.querySelectorAll('button'))
        .find((button) => button.textContent === 'Quote')
        ?.click(),
    );
    expect(composer.insertIntoComposer).toHaveBeenCalledWith(
      expect.stringContaining('@@ -1,1 +1,1 @@'),
    );
    expect(actions.onStage).toHaveBeenCalledTimes(1);
    expect(actions.onToggleFile).not.toHaveBeenCalled();
  });

  it('preserves unstaging for mixed changes and separates discard from the primary action', () => {
    const { container, file, actions, openMenu, select } = renderFile({
      hasStagedChanges: true,
      hasUnstagedChanges: true,
    });
    expect(container.querySelector('[aria-label="Stage file"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="Discard changes"]')).toBeNull();
    openMenu();
    expect(document.querySelector('[role="separator"]')).not.toBeNull();
    select('Unstage file');
    expect(actions.onUnstage).toHaveBeenCalledExactlyOnceWith(file.path);
    openMenu();
    select('Discard file changes');
    expect(actions.onRevert).toHaveBeenCalledExactlyOnceWith(file.path);
    expect(actions.onStage).not.toHaveBeenCalled();
  });

  it('opens files and adds context from the menu without toggling the diff', () => {
    const { file, actions, openMenu, select } = renderFile();
    openMenu();
    select('Open in editor');
    expect(actions.onOpenFile).toHaveBeenCalledExactlyOnceWith(file.path);
    openMenu();
    select('Add to chat');
    expect(composer.attachContextToComposer).toHaveBeenCalledWith(
      expect.objectContaining({ value: file.path, title: 'terraform.tfvars.example' }),
    );
    expect(actions.onToggleFile).not.toHaveBeenCalled();
  });

  it('offers unstage for staged files and no mutation actions for committed files', () => {
    const staged = renderFile({ state: 'staged' });
    act(() =>
      staged.container.querySelector<HTMLButtonElement>('[aria-label="Unstage file"]')?.click(),
    );
    expect(staged.actions.onUnstage).toHaveBeenCalledExactlyOnceWith(staged.file.path);
    const committed = renderFile({ state: 'committed' });
    expect(committed.container.querySelector('[aria-label="Stage file"]')).toBeNull();
    expect(committed.container.querySelector('[aria-label="Unstage file"]')).toBeNull();
    committed.openMenu();
    expect(document.body.textContent).not.toContain('Discard file changes');
  });
});
