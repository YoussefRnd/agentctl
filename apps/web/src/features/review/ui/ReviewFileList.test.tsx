import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { CodeReviewRun } from '@agentctl/shared';
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { ReviewFileList } from './ReviewFileList';
import { mockVirtualViewport } from '@/test-utils/virtualViewport';
import { parseDiff } from '@/shared/lib/diff-parser';
import type { ReviewFile } from './ReviewHeader';

const composer = vi.hoisted(() => ({
  attachContextToComposer: vi.fn(),
  insertIntoComposer: vi.fn(),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn() } }));

const roots: Root[] = [];
const clients: QueryClient[] = [];
afterEach(() => {
  act(() => roots.splice(0).forEach((root) => root.unmount()));
  clients.splice(0).forEach((client) => client.clear());
  document.body.innerHTML = '';
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

function renderFile(overrides: Partial<ReviewFile> = {}, composerActions = composer) {
  mockVirtualViewport();
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
        composerActions={composerActions}
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
  it('routes context and quotes to the actions supplied by its containing page', async () => {
    const target = { attachContextToComposer: vi.fn(), insertIntoComposer: vi.fn() };
    const { container, openMenu, select, file } = renderFile({}, target);
    openMenu();
    select('Add to chat');
    expect(target.attachContextToComposer).toHaveBeenCalledWith(
      expect.objectContaining({ value: file.path, type: 'file' }),
    );
    act(() =>
      [...container.querySelectorAll('button')]
        .find((button) => button.textContent === 'Quote')
        ?.click(),
    );
    expect(target.insertIntoComposer).toHaveBeenCalledWith(
      expect.stringContaining(`@${file.path}`),
    );
    expect(composer.attachContextToComposer).not.toHaveBeenCalled();
    expect(composer.insertIntoComposer).not.toHaveBeenCalled();
  });
  it('virtualizes many small hunks together and keeps split scrolling bounded', async () => {
    mockVirtualViewport();
    const path = 'src/large.ts';
    const diff = Array.from(
      { length: 500 },
      (_, index) => `@@ -${index + 1},1 +${index + 1},1 @@\n-old${index}\n+new${index}`,
    ).join('\n');
    const file = { path, state: 'modified' as const, diff, hunks: parseDiff(diff) };
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    const render = (viewMode: 'inline' | 'split', wrapLines = false) =>
      root.render(
        <ReviewFileList
          composerActions={composer}
          files={[file]}
          collapsedFiles={{ [path]: false }}
          fileStats={new Map()}
          viewMode={viewMode}
          wrapLines={wrapLines}
          onToggleFile={() => {}}
        />,
      );
    await act(async () => render('inline'));
    expect(container.querySelectorAll('[data-diff-scroll]')).toHaveLength(1);
    expect(container.querySelector('[data-diff-scroll]')?.className).not.toContain('max-h');
    expect(container.querySelectorAll('[data-diff-content]').length).toBeGreaterThan(0);
    expect(container.querySelectorAll('[data-diff-content]').length).toBeLessThan(100);
    await act(async () => render('split', true));
    const viewport = container.querySelector<HTMLElement>('[data-review-scroll]')!;
    await act(async () => viewport.scrollTo({ top: viewport.scrollHeight - 600 }));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(container.querySelectorAll('[data-split-row]').length).toBeLessThan(100);
    expect(container.textContent).toContain('new499');
    act(() =>
      [...container.querySelectorAll('button')]
        .find((button) => button.textContent === 'Quote')
        ?.click(),
    );
    expect(composer.insertIntoComposer).toHaveBeenCalledWith(expect.stringContaining(`@${path}`));
  });
  it('keeps expanded files near the viewport mounted and navigates to an off-screen file', async () => {
    const scrollTo = mockVirtualViewport();
    const files = Array.from({ length: 200 }, (_, index) => {
      const diff =
        '@@ -0,0 +1,80 @@\n' +
        Array.from({ length: 80 }, (_, line) => `+const value${line} = ${index};`).join('\n');
      return {
        path: `src/file-${index}.ts`,
        state: 'untracked' as const,
        diff,
        additions: 80,
        deletions: 0,
        hunks: parseDiff(diff),
      };
    });
    const collapsedFiles = Object.fromEntries(files.map((file) => [file.path, false]));
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () =>
      root.render(
        <ReviewFileList
          composerActions={composer}
          files={files}
          collapsedFiles={collapsedFiles}
          fileStats={new Map()}
          viewMode="inline"
          onToggleFile={() => {}}
        />,
      ),
    );
    const mounted = container.querySelectorAll('[aria-label^="Toggle diff for"]');
    expect(mounted.length).toBeGreaterThan(0);
    expect(mounted.length).toBeLessThan(10);
    expect(container.querySelectorAll('[data-diff-content]').length).toBeLessThan(800);
    function TargetedList() {
      const [target, setTarget] = useState<string | null>('src/file-180.ts');
      return (
        <ReviewFileList
          composerActions={composer}
          files={files}
          collapsedFiles={collapsedFiles}
          fileStats={new Map()}
          viewMode="inline"
          onToggleFile={() => {}}
          targetFilePath={target}
          onTargetFileHandled={() => setTarget(null)}
        />
      );
    }
    await act(async () => root.render(<TargetedList />));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(
      container.querySelector('[aria-label="Toggle diff for src/file-180.ts"]'),
    ).not.toBeNull();
    expect(scrollTo).toHaveBeenCalled();
    expect(container.querySelector<HTMLElement>('[data-review-scroll]')!.scrollTop).toBeGreaterThan(
      0,
    );
    vi.restoreAllMocks();
  });
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

it('places findings on the displayed side in unified and split layouts, including committed deletions', async () => {
  mockVirtualViewport();
  const path = 'src/input.ts';
  const diff = '@@ -1 +1 @@\n-old\n+new';
  const file = { path, state: 'modified' as const, diff, hunks: parseDiff(diff) };
  const finding = {
    id: '22222222-2222-4222-8222-222222222222',
    path,
    line: 1,
    severity: 'high' as const,
    title: 'Inline missing guard',
    body: 'Empty input reaches the changed call.',
    status: 'open' as const,
    resolution: null,
  };
  const run = { id: '11111111-1111-4111-8111-111111111111', findings: [finding] } as CodeReviewRun;
  const onResolve = vi.fn(async () => {});
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(client);
  const render = (
    viewMode: 'inline' | 'split',
    displayed = file as ReviewFile & { hunks: ReturnType<typeof parseDiff> },
  ) =>
    root.render(
      <QueryClientProvider client={client}>
        <ReviewFileList
          sessionId="session-1"
          codeReview={run}
          onResolveFinding={onResolve}
          composerActions={composer}
          files={[displayed]}
          collapsedFiles={{ [path]: false }}
          fileStats={new Map()}
          viewMode={viewMode}
          onToggleFile={() => {}}
        />
      </QueryClientProvider>,
    );
  for (const mode of ['inline', 'split'] as const) {
    await act(async () => render(mode));
    const annotation = [...container.querySelectorAll<HTMLElement>('[data-index]')].find(
      (element) =>
        element.textContent?.includes('Inline missing guard') && element.querySelector('li'),
    )!;
    expect(annotation).toBeDefined();
    expect(annotation.previousElementSibling?.textContent).toContain('new');
    if (mode === 'inline')
      expect(annotation.previousElementSibling?.textContent).not.toContain('old');
    expect(container.textContent).not.toContain('Loading captured code');
  }
  const deleted = {
    ...file,
    state: 'committed' as const,
    diff: '@@ -1 +0,0 @@\n-old',
    hunks: parseDiff('@@ -1 +0,0 @@\n-old'),
  };
  for (const mode of ['inline', 'split'] as const) {
    await act(async () => render(mode, deleted));
    const annotation = [...container.querySelectorAll<HTMLElement>('[data-index]')].find(
      (element) =>
        element.textContent?.includes('Inline missing guard') && element.querySelector('li'),
    )!;
    expect(annotation).toBeDefined();
    expect(annotation.previousElementSibling?.textContent).toContain('old');
    expect(annotation.previousElementSibling?.textContent).not.toContain('new');
  }
  await act(async () =>
    [...container.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent?.includes('Mark fixed'))!
      .click(),
  );
  expect(onResolve).toHaveBeenCalledWith(finding.id, { status: 'fixed' });
});
