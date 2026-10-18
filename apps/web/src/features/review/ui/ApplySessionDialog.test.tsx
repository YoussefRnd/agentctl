import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vite-plus/test';
import { ApplySessionDialog } from './ApplySessionDialog';

const mocks = vi.hoisted(() => ({ preview: vi.fn(), generate: vi.fn() }));
vi.mock('@agentctl/api-client', () => ({
  api: { getSessionMergePreview: mocks.preview },
  generateGitDraft: mocks.generate,
  assertApiStatus: (response: { status: number; body: { message?: string } }, status: number) => {
    if (response.status !== status) throw new Error(response.body.message ?? 'Preview failed');
  },
}));
let root: Root;
let client: QueryClient;
beforeEach(() => {
  mocks.generate
    .mockReset()
    .mockResolvedValue({ title: 'feat: session changes', body: 'Cumulative changes' });
  mocks.preview.mockReset().mockResolvedValue({
    status: 200,
    body: {
      baseBranch: 'main',
      targetPath: '/repo',
      uncommittedCount: 0,
      hasMergeHead: false,
      blockedReason: null,
      hasConflicts: false,
      conflictingFiles: [],
    },
  });
});
afterEach(() => {
  act(() => root?.unmount());
  client?.clear();
  document.body.innerHTML = '';
});
async function render(
  options: {
    mode?: 'local' | 'worktree';
    count?: number;
    busy?: boolean;
    commit?: () => Promise<void>;
    confirm?: () => Promise<void>;
  } = {},
) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const commit = vi.fn(options.commit ?? (async () => {}));
  const confirm = vi.fn(options.confirm ?? (async () => {}));
  const close = vi.fn();
  let toggle!: (open: boolean) => void;
  function Harness() {
    const [open, setOpen] = useState(true);
    const [message, setMessage] = useState('');
    toggle = setOpen;
    return (
      <QueryClientProvider client={client}>
        <ApplySessionDialog
          open={open}
          onOpenChange={(next) => {
            close(next);
            setOpen(next);
          }}
          sessionId="session"
          mode={options.mode ?? 'worktree'}
          currentBranch="feature"
          baseBranch="main"
          branches={['main', 'develop', 'release/1.0', 'feature']}
          uncommittedCount={options.count ?? 0}
          workspaceBusy={options.busy ?? false}
          defaultMessage="Build feature"
          commitMessage={message}
          onCommitMessageChange={setMessage}
          onCommitAll={commit}
          onConfirm={confirm}
        />
      </QueryClientProvider>
    );
  }
  await act(async () => {
    root.render(<Harness />);
  });
  if (options.mode !== 'local' && !options.busy)
    await act(async () => {
      await vi.waitFor(() => expect(mocks.preview).toHaveBeenCalled());
    });
  const button = (label: string) =>
    Array.from(document.querySelectorAll('button')).find((node) =>
      node.textContent?.includes(label),
    )!;
  return { commit, confirm, close, button, toggle };
}

it('shows the source, destination, retention, and local-only merge behavior', async () => {
  const { button } = await render();
  await vi.waitFor(() => expect(button('Merge session').disabled).toBe(false));
  expect(document.body.textContent).toContain('feature');
  expect(document.body.textContent).toContain('Destination: /repo');
  expect(document.body.textContent).toContain('kept until you delete');
  expect(document.body.textContent).toContain('Push separately');
});

it('commits all explicitly counted changes before merging, using a default message', async () => {
  mocks.preview.mockResolvedValue({
    status: 200,
    body: {
      baseBranch: 'main',
      targetPath: '/repo',
      uncommittedCount: 3,
      hasMergeHead: false,
      blockedReason: null,
      hasConflicts: false,
      conflictingFiles: [],
    },
  });
  const { button, commit, confirm, close } = await render();
  await vi.waitFor(() => expect(button('Commit all and merge')?.disabled).toBe(false));
  expect(document.body.textContent).toContain('all 3 changed files');
  await act(async () => {
    button('Commit all and merge').click();
  });
  expect(commit).toHaveBeenCalledWith('Build feature');
  expect(confirm).toHaveBeenCalledWith('Build feature', 'main');
  expect(commit.mock.invocationCallOrder[0]).toBeLessThan(confirm.mock.invocationCallOrder[0]);
  expect(close).toHaveBeenCalledWith(false);
});

it('keeps the dialog open and explains a successful commit followed by a failed merge', async () => {
  mocks.preview.mockResolvedValue({
    status: 200,
    body: {
      uncommittedCount: 1,
      hasMergeHead: false,
      blockedReason: null,
      hasConflicts: false,
      conflictingFiles: [],
    },
  });
  const { button, close } = await render({
    confirm: async () => {
      throw new Error('Destination changed; retry');
    },
  });
  await vi.waitFor(() => expect(button('Commit all and merge')?.disabled).toBe(false));
  await act(async () => {
    button('Commit all and merge').click();
  });
  expect(document.querySelector('[role="alert"]')?.textContent).toContain(
    'Your changes were committed. Destination changed; retry',
  );
  expect(close).not.toHaveBeenCalled();
});

it('does not merge when committing fails', async () => {
  const { button, confirm } = await render({
    mode: 'local',
    count: 1,
    commit: async () => {
      throw new Error('Hook failed');
    },
  });
  await act(async () => {
    button('Commit all and finish').click();
  });
  expect(confirm).not.toHaveBeenCalled();
  expect(document.querySelector('[role="alert"]')?.textContent).toBe('Hook failed');
});

it('blocks a dirty destination and offers a readiness recheck', async () => {
  mocks.preview.mockResolvedValue({
    status: 200,
    body: {
      uncommittedCount: 0,
      hasMergeHead: false,
      blockedReason: 'Commit or stash main changes',
      hasConflicts: false,
      conflictingFiles: [],
    },
  });
  const { button, confirm } = await render();
  await vi.waitFor(() =>
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(
      'Commit or stash main changes',
    ),
  );
  expect(button('Merge session').disabled).toBe(true);
  await act(async () => {
    button('Recheck').click();
  });
  expect(mocks.preview.mock.calls.length).toBeGreaterThan(1);
  expect(confirm).not.toHaveBeenCalled();
});

it('fails closed when preview is unavailable', async () => {
  mocks.preview.mockResolvedValue({ status: 400, body: { message: 'Missing destination branch' } });
  const { button, confirm } = await render();
  await vi.waitFor(() =>
    expect(document.querySelector('[role="alert"]')?.textContent).toBe(
      'Missing destination branch',
    ),
  );
  expect(button('Merge session').disabled).toBe(true);
  expect(confirm).not.toHaveBeenCalled();
});

it('guides conflict resolution without claiming it will finish the session', async () => {
  mocks.preview.mockResolvedValue({
    status: 200,
    body: {
      uncommittedCount: 0,
      hasMergeHead: false,
      blockedReason: null,
      hasConflicts: true,
      conflictingFiles: ['src/app.ts'],
    },
  });
  const { button } = await render();
  await vi.waitFor(() => expect(button('Prepare conflict resolution')?.disabled).toBe(false));
  expect(document.body.textContent).toContain('src/app.ts');
  expect(document.body.textContent).toContain('stage each resolution');
});

it('finishes local sessions without describing a merge into main', async () => {
  const { button, confirm } = await render({ mode: 'local' });
  expect(document.body.textContent).not.toContain('Merge session');
  expect(mocks.preview).not.toHaveBeenCalled();
  await act(async () => {
    button('Finish session').click();
  });
  expect(confirm).toHaveBeenCalledWith('Build feature', undefined);
});

it('prevents duplicate submissions while a merge is pending', async () => {
  let finish!: () => void;
  const pending = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const { button, confirm, close } = await render({ confirm: () => pending });
  await vi.waitFor(() => expect(button('Merge session')?.disabled).toBe(false));
  act(() => {
    button('Merge session').click();
    button('Merge session')?.click();
  });
  expect(confirm).toHaveBeenCalledOnce();
  expect(close).not.toHaveBeenCalled();
  await act(async () => {
    finish();
    await pending;
  });
});

it('checks and merges the selected branch without reusing the previous readiness result', async () => {
  let resolvePreview!: (response: unknown) => void;
  const pendingPreview = new Promise((resolve) => {
    resolvePreview = resolve;
  });
  const ready = {
    status: 200,
    body: {
      baseBranch: 'main',
      targetPath: '/repo',
      uncommittedCount: 0,
      hasMergeHead: false,
      blockedReason: null,
      hasConflicts: false,
      conflictingFiles: [],
    },
  };
  mocks.preview.mockImplementation(({ query }: { query: { targetBranch: string } }) =>
    query.targetBranch === 'develop' ? pendingPreview : Promise.resolve(ready),
  );
  const { button, confirm } = await render();
  await vi.waitFor(() => expect(button('Merge session').disabled).toBe(false));
  const selector = document.querySelector<HTMLSelectElement>('[aria-label="Destination branch"]')!;
  expect(Array.from(selector.options).map((option) => option.value)).toEqual([
    'main',
    'develop',
    'release/1.0',
  ]);
  await act(async () => {
    selector.value = 'develop';
    selector.dispatchEvent(new Event('change', { bubbles: true }));
  });
  expect(button('Merge session').disabled).toBe(true);
  expect(document.body.textContent).not.toContain('Destination: /repo');
  expect(confirm).not.toHaveBeenCalled();
  await act(async () => {
    resolvePreview({
      ...ready,
      body: { ...ready.body, baseBranch: 'develop', targetPath: '/develop-checkout' },
    });
  });
  await vi.waitFor(() => expect(button('Merge session').disabled).toBe(false));
  expect(document.body.textContent).toContain('Destination: /develop-checkout');
  await act(async () => {
    button('Merge session').click();
  });
  expect(mocks.preview).toHaveBeenCalledWith({
    params: { id: 'session' },
    query: { targetBranch: 'develop' },
  });
  expect(confirm).toHaveBeenCalledWith('Build feature', 'develop');
});

it('keeps a pending conflict resolution tied to its original destination', async () => {
  mocks.preview.mockResolvedValue({
    status: 200,
    body: {
      baseBranch: 'main',
      targetPath: '/repo',
      uncommittedCount: 1,
      hasMergeHead: true,
      blockedReason: null,
      hasConflicts: false,
      conflictingFiles: [],
    },
  });
  await render();
  await vi.waitFor(() =>
    expect(
      document.querySelector<HTMLSelectElement>('[aria-label="Destination branch"]')?.disabled,
    ).toBe(true),
  );
  expect(document.body.textContent).toContain(
    'Finish or abort the pending merge before changing its destination',
  );
});

it('generates cumulative merge text for the selected destination without committing or merging', async () => {
  const { button, commit, confirm } = await render();
  await vi.waitFor(() => expect(button('Generate message').disabled).toBe(false));
  const selector = document.querySelector<HTMLSelectElement>('[aria-label="Destination branch"]')!;
  await act(async () => {
    selector.value = 'release/1.0';
    selector.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await vi.waitFor(() => expect(button('Generate message').disabled).toBe(false));
  await act(async () => button('Generate message').click());
  expect(mocks.generate).toHaveBeenCalledWith('session', {
    kind: 'merge',
    targetBranch: 'release/1.0',
  });
  expect(commit).not.toHaveBeenCalled();
  expect(confirm).not.toHaveBeenCalled();
});

it('retains the merge destination and manual message across closing and reopening', async () => {
  const { button, toggle, confirm } = await render();
  await vi.waitFor(() => expect(button('Merge session').disabled).toBe(false));
  await act(async () => {
    const selector = document.querySelector<HTMLSelectElement>(
      '[aria-label="Destination branch"]',
    )!;
    selector.value = 'develop';
    selector.dispatchEvent(new Event('change', { bubbles: true }));
  });
  act(() => {
    const editor = document.querySelector<HTMLTextAreaElement>('#commit-message-input')!;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(
      editor,
      'Keep my merge message',
    );
    editor.dispatchEvent(new Event('input', { bubbles: true }));
    button('Cancel').click();
  });
  await act(async () => toggle(true));
  expect(
    document.querySelector<HTMLSelectElement>('[aria-label="Destination branch"]')?.value,
  ).toBe('develop');
  expect(document.querySelector<HTMLTextAreaElement>('#commit-message-input')?.value).toBe(
    'Keep my merge message',
  );
  await vi.waitFor(() => expect(button('Merge session').disabled).toBe(false));
  await act(async () => button('Merge session').click());
  expect(confirm).toHaveBeenCalledWith('Keep my merge message', 'develop');
});
it('rechecks after a partial failure and retries merging without another commit', async () => {
  const ready = {
    baseBranch: 'main',
    targetPath: '/repo',
    uncommittedCount: 0,
    hasMergeHead: false,
    blockedReason: null,
    hasConflicts: false,
    conflictingFiles: [],
  };
  mocks.preview
    .mockResolvedValueOnce({ status: 200, body: { ...ready, uncommittedCount: 1 } })
    .mockResolvedValue({ status: 200, body: ready });
  let fail = true;
  const { button, commit, confirm } = await render({
    confirm: async () => {
      if (fail) {
        fail = false;
        throw new Error('Destination changed; retry');
      }
    },
  });
  await vi.waitFor(() => expect(button('Commit all and merge')?.disabled).toBe(false));
  await act(async () => button('Commit all and merge').click());
  await vi.waitFor(() => expect(button('Merge session')?.disabled).toBe(false));
  await act(async () => button('Merge session').click());
  expect(commit).toHaveBeenCalledOnce();
  expect(confirm).toHaveBeenCalledTimes(2);
});
