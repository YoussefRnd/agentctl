import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CreatePullRequestDialog } from './CreatePullRequestDialog';
const mocks = vi.hoisted(() => ({
  generate: vi.fn(),
  create: vi.fn(),
  branch: null as string | null,
}));
vi.mock('@agentctl/api-client', async (original) => ({
  ...(await original<object>()),
  generateGitDraft: mocks.generate,
}));
vi.mock('../model/useGitStatus', () => ({
  useGitStatus: () => ({
    gitStatus: { remoteName: 'origin', branch: mocks.branch },
    createPullRequest: mocks.create,
    isCreatingPullRequest: false,
  }),
}));
let root: Root;
let toggle: (open: boolean) => void;
let setBusy: (busy: boolean) => void;
let setCount: (count: number) => void;
let success = vi.fn();
beforeEach(() => {
  success = vi.fn();
  mocks.branch = null;
  mocks.generate.mockReset().mockResolvedValue({
    title: 'Improve Git review',
    body: '## Summary\nPreserve work\n## Testing\nNot run',
  });
  mocks.create
    .mockReset()
    .mockResolvedValue({ status: 'created', pr: { url: 'https://example.invalid/pr/1' } });
});
afterEach(() => {
  act(() => root?.unmount());
  document.body.innerHTML = '';
});
function render() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  function Harness() {
    const [open, setOpen] = useState(true);
    toggle = setOpen;
    const [busy, updateBusy] = useState(false);
    const [count, updateCount] = useState(0);
    setBusy = updateBusy;
    setCount = updateCount;
    return (
      <CreatePullRequestDialog
        sessionId="session"
        open={open}
        onOpenChange={setOpen}
        currentBranch="feature"
        defaultBaseBranch="develop"
        defaultTitle="Manual draft"
        workspaceBusy={busy}
        uncommittedCount={count}
        onSuccess={success}
      />
    );
  }
  act(() => root.render(<Harness />));
}
const button = (text: string) =>
  Array.from(document.querySelectorAll('button')).find((node) => node.textContent?.includes(text))!;
const title = () => document.querySelector<HTMLInputElement>('#pr-title-input')!;
function change(node: HTMLInputElement, value: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(node, value);
    node.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

it('generates editable PR content against the chosen base without publishing', async () => {
  render();
  await act(async () => button('Generate title').click());
  expect(mocks.generate).toHaveBeenCalledWith('session', { kind: 'pr', targetBranch: 'develop' });
  expect(title().value).toBe('Improve Git review');
  expect(document.querySelector<HTMLTextAreaElement>('#pr-body-input')!.value).toContain('Not run');
  expect(mocks.create).not.toHaveBeenCalled();
  change(title(), 'My reviewed title');
  await act(async () => button('Push and create PR').click());
  expect(mocks.create).toHaveBeenCalledWith(
    expect.objectContaining({ title: 'My reviewed title', baseBranch: 'develop' }),
  );
});
it('does not overwrite text edited while generation is pending', async () => {
  let finish!: (value: { title: string; body: string }) => void;
  mocks.generate.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  render();
  act(() => button('Generate title').click());
  change(title(), 'Keep my own title');
  await act(async () => finish({ title: 'Old result', body: 'Old result' }));
  expect(title().value).toBe('Keep my own title');
  expect(document.body.textContent).toContain('draft or selection changed');
  expect(mocks.create).not.toHaveBeenCalled();
});
it('drops responses after retargeting and after closing/reopening', async () => {
  let finish!: (value: { title: string; body: string }) => void;
  mocks.generate.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  render();
  act(() => button('Generate title').click());
  change(document.querySelector<HTMLInputElement>('[aria-label="PR base branch"]')!, 'release');
  await act(async () => finish({ title: 'Wrong base', body: 'Wrong base' }));
  expect(title().value).toBe('Manual draft');
  act(() => button('Generate title').click());
  act(() => toggle(false));
  act(() => toggle(true));
  await act(async () => finish({ title: 'Closed request', body: 'Closed request' }));
  expect(title().value).toBe('Manual draft');
});
it('preserves manual drafts across closing and provider failures', async () => {
  mocks.generate.mockRejectedValue(new Error('Provider is offline'));
  render();
  change(title(), 'My saved draft');
  await act(async () => button('Generate title').click());
  expect(title().value).toBe('My saved draft');
  expect(document.body.textContent).toContain('Provider is offline');
  act(() => toggle(false));
  act(() => toggle(true));
  expect(title().value).toBe('My saved draft');
});
it('guards duplicate publication even before the mutation state rerenders', async () => {
  let finish!: (value: unknown) => void;
  mocks.create.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  render();
  const publish = button('Push and create PR');
  act(() => {
    publish.click();
    publish.click();
  });
  expect(mocks.create).toHaveBeenCalledOnce();
  await act(async () => finish({ status: 'created', pr: { url: 'https://example.invalid/pr/1' } }));
});

it('keeps generation locked after the base changes until the original request settles', async () => {
  let finish!: (value: { title: string; body: string }) => void;
  mocks.generate.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  render();
  act(() => button('Generate title').click());
  change(document.querySelector<HTMLInputElement>('[aria-label="PR base branch"]')!, 'release');
  expect(button('Generating')?.disabled).toBe(true);
  expect(button('Push and create PR').disabled).toBe(true);
  await act(async () => finish({ title: 'Wrong base', body: 'Wrong base' }));
  expect(title().value).toBe('Manual draft');
  expect(button('Generate title').disabled).toBe(false);
  expect(mocks.generate).toHaveBeenCalledOnce();
});
it('blocks publishing when the workspace becomes busy or dirty while preserving the draft', async () => {
  render();
  act(() => setBusy(true));
  expect(button('Generate title').disabled).toBe(true);
  expect(button('Push and create PR').disabled).toBe(true);
  expect(document.body.textContent).toContain('Stop the active turn');
  act(() => {
    setBusy(false);
    setCount(2);
  });
  expect(button('Push and create PR').disabled).toBe(true);
  expect(document.body.textContent).toContain('uncommitted');
  expect(title().value).toBe('Manual draft');
  expect(mocks.create).not.toHaveBeenCalled();
  act(() => setCount(0));
  expect(button('Push and create PR').disabled).toBe(false);
});
it.each(['created', 'already_exists', 'needs_browser'] as const)(
  'reports the exact publication outcome: %s',
  async (status) => {
    const url = 'https://example.invalid/pr/1';
    mocks.create.mockResolvedValue(
      status === 'needs_browser' ? { status, compareUrl: url } : { status, pr: { url } },
    );
    render();
    await act(async () => button('Push and create PR').click());
    expect(success).toHaveBeenCalledWith(url, status);
  },
);

it('shows and publishes the actual Git branch rather than a stale session label', async () => {
  mocks.branch = 'actual-feature';
  render();
  expect(document.querySelector('code[title]')?.textContent).toBe('actual-feature');
  await act(async () => button('Push and create PR').click());
  expect(mocks.create).toHaveBeenCalledWith(
    expect.objectContaining({ headBranch: 'actual-feature' }),
  );
});
it('drops generation results when the source branch changes', async () => {
  let finish!: (value: { title: string; body: string }) => void;
  mocks.generate.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  render();
  act(() => button('Generate title').click());
  mocks.branch = 'another-feature';
  act(() => setCount(1));
  await act(async () => finish({ title: 'Wrong branch draft', body: 'Wrong branch draft' }));
  expect(title().value).toBe('Manual draft');
  expect(document.body.textContent).toContain('draft or selection changed');
});

it('keeps publication visibly pending and prevents dismissing or editing until it settles', async () => {
  let finish!: (result: unknown) => void;
  mocks.create.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  render();
  act(() => button('Push and create PR').click());
  expect(button('Publishing PR')?.disabled).toBe(true);
  expect(button('Cancel').disabled).toBe(true);
  expect(title().disabled).toBe(true);
  const dialog = document.querySelector('[role="dialog"]')!;
  act(() => dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  expect(mocks.create).toHaveBeenCalledOnce();
  await act(async () => finish({ status: 'created', pr: { url: 'https://example.invalid/pr/1' } }));
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});
it('retains PR fields after a publication failure and supports retry after reopening', async () => {
  mocks.create.mockRejectedValueOnce(new Error('GitHub unavailable'));
  render();
  change(title(), 'Keep my PR draft');
  change(document.querySelector<HTMLInputElement>('[aria-label="PR base branch"]')!, 'release');
  await act(async () => button('Push and create PR').click());
  expect(document.querySelector('[role="alert"]')?.textContent).toBe('GitHub unavailable');
  act(() => button('Cancel').click());
  act(() => toggle(true));
  expect(title().value).toBe('Keep my PR draft');
  expect(document.querySelector<HTMLInputElement>('[aria-label="PR base branch"]')?.value).toBe(
    'release',
  );
  expect(document.querySelector('[role="alert"]')).toBeNull();
  await act(async () => button('Push and create PR').click());
  expect(mocks.create).toHaveBeenLastCalledWith(
    expect.objectContaining({ title: 'Keep my PR draft', baseBranch: 'release' }),
  );
  expect(success).toHaveBeenCalledOnce();
});

it('explains a detached source branch and disables publication and generation', () => {
  mocks.branch = 'HEAD';
  render();
  expect(button('Push and create PR').disabled).toBe(true);
  expect(button('Generate title').disabled).toBe(true);
  expect(document.body.textContent).toContain('Check out a branch');
});
