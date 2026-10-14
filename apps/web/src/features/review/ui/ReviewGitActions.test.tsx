// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ReviewGitActions } from './ReviewGitActions';

const generation = vi.hoisted(() => ({ generate: vi.fn() }));
vi.mock('@agentctl/api-client', async (original) => ({
  ...(await original<object>()),
  generateGitDraft: generation.generate,
}));

const roots: Root[] = [];

afterEach(() => {
  act(() => {
    for (const root of roots.splice(0)) root.unmount();
  });
  document.body.innerHTML = '';
  localStorage.removeItem('agentctl.allowBaseBranchPush');
});

function renderActions(
  options: {
    sessionId?: string;
    stagedCount?: number;
    unstagedCount?: number;
    uncommittedCount?: number;
    additions?: number;
    deletions?: number;
    aheadCount?: number;
    behindCount?: number;
    hasUpstream?: boolean;
    isBaseBranch?: boolean;
    blockedReason?: string;
    openMenu?: boolean;
    openSync?: boolean;
    openCommitDialog?: boolean;
    commitMessage?: string;
    workspaceBusy?: boolean;
  } = {},
) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  const actions = {
    onCommit: vi.fn().mockResolvedValue(undefined),
    onPush: vi.fn().mockResolvedValue(undefined),
    onPull: vi.fn().mockResolvedValue(undefined),
    onFetch: vi.fn().mockResolvedValue(undefined),
    onCreateBranch: vi.fn().mockResolvedValue(undefined),
    onSwitchBranch: vi.fn().mockResolvedValue(undefined),
    onCreatePullRequest: vi.fn(),
    onApplySession: vi.fn(),
    onDiscardChanges: vi.fn(),
  };

  const render = () => {
    root.render(
      <ReviewGitActions
        sessionId={options.sessionId}
        branch="feature/review"
        branches={['main', 'feature/review']}
        hasBranchChanges
        stagedCount={options.stagedCount ?? 0}
        unstagedCount={options.unstagedCount ?? 0}
        uncommittedCount={options.uncommittedCount}
        additions={options.additions ?? 42}
        deletions={options.deletions ?? 11}
        aheadCount={options.aheadCount ?? 0}
        behindCount={options.behindCount ?? 0}
        hasUpstream={options.hasUpstream ?? true}
        isBaseBranch={options.isBaseBranch ?? false}
        canPush
        isLoadingGitStatus={false}
        workspaceBusy={options.workspaceBusy}
        commitMessage={options.commitMessage ?? 'feat: improve review workflow'}
        onCommitMessageChange={vi.fn()}
        onSwitchBranch={actions.onSwitchBranch}
        onCommit={actions.onCommit}
        onPush={actions.onPush}
        onPull={actions.onPull}
        onFetch={actions.onFetch}
        onCreateBranch={actions.onCreateBranch}
        onOpenPullRequestDialog={actions.onCreatePullRequest}
        pullRequestBlockedReason={options.blockedReason}
        onApplySession={actions.onApplySession}
        onDiscardChanges={actions.onDiscardChanges}
      />,
    );
  };
  act(render);

  const findButton = (text: string) => {
    const surface =
      document.querySelector('[data-slot="dialog-content"], [data-slot="popover-content"]') ??
      document;
    return Array.from(surface.querySelectorAll('button')).find((button) =>
      button.textContent?.includes(text),
    );
  };
  act(() => {
    if (options.openSync)
      container.querySelector<HTMLButtonElement>('[aria-label="Sync"]')!.click();
    else if (options.openMenu !== false) {
      if (options.openCommitDialog !== false)
        container.querySelector<HTMLButtonElement>('[aria-label="Commit"]')!.click();
      else container.querySelector<HTMLButtonElement>('[aria-label="Session actions"]')!.click();
    }
  });

  return {
    container,
    actions,
    findButton,
    rerender: (updates: Partial<typeof options>) => {
      Object.assign(options, updates);
      act(render);
    },
  };
}

describe('ReviewGitActions', () => {
  it.each(['Escape', 'close button'])(
    'dismisses the commit dialog with %s while the agent is running',
    async (method) => {
      const { container, actions, findButton } = renderActions({
        stagedCount: 1,
        openMenu: false,
        workspaceBusy: true,
      });
      act(() => container.querySelector<HTMLButtonElement>('[aria-label="Commit"]')!.click());
      const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
      expect(dialog).not.toBeNull();
      expect(findButton('Commit')?.disabled).toBe(true);
      expect(document.querySelector<HTMLInputElement>('input[type="checkbox"]')?.disabled).toBe(
        true,
      );
      act(() => {
        if (method === 'Escape')
          dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        else dialog.querySelector<HTMLButtonElement>('[aria-label="Close dialog"]')!.click();
      });
      await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeNull());
      expect(actions.onCommit).not.toHaveBeenCalled();
      expect(actions.onPush).not.toHaveBeenCalled();
    },
  );

  it('opens and dismisses the Git menu while the agent is running, keeping mutations disabled', async () => {
    const { findButton, actions } = renderActions({
      workspaceBusy: true,
      openCommitDialog: false,
      openSync: true,
    });
    expect(findButton('Fetch updates')).toBeDefined();
    expect(findButton('Fetch updates')?.disabled).toBe(true);
    act(() =>
      findButton('Fetch updates')!.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      ),
    );
    await vi.waitFor(() => expect(findButton('Fetch updates')).toBeUndefined());
    expect(actions.onFetch).not.toHaveBeenCalled();
  });

  it('requires an explicit commit message', async () => {
    const { actions, findButton } = renderActions({ stagedCount: 1, commitMessage: '' });
    expect(findButton('Commit')?.disabled).toBe(true);
    expect(findButton('Commit and push')).toBeUndefined();
    await act(async () => findButton('Commit')?.click());
    expect(actions.onCommit).not.toHaveBeenCalled();
  });

  it('allows committing seven untracked files even when their textual line totals are zero', async () => {
    const { actions, findButton } = renderActions({ unstagedCount: 7, additions: 0, deletions: 0 });
    expect(findButton('Commit')?.disabled).toBe(false);
    await act(async () => findButton('Commit')?.click());
    expect(actions.onCommit).toHaveBeenCalledWith('feat: improve review workflow', true);
  });

  it('passes the trimmed message and inclusion choice in one commit operation', async () => {
    const { actions, findButton } = renderActions({
      unstagedCount: 1,
      commitMessage: '  fix: review  ',
    });
    await act(async () => findButton('Commit')?.click());
    expect(actions.onCommit).toHaveBeenCalledWith('fix: review', true);
  });

  it('keeps merge visible and discard separate from commit and sync', () => {
    const { actions, findButton, container } = renderActions({ openMenu: false });
    act(() => findButton('Merge…')!.click());
    expect(actions.onApplySession).toHaveBeenCalledOnce();
    act(() =>
      container.querySelector<HTMLButtonElement>('[aria-label="Session actions"]')!.click(),
    );
    expect(findButton('Commit')).toBeUndefined();
    expect(findButton('Merge')).toBeUndefined();
    expect(findButton('Fetch')).toBeUndefined();
    act(() => findButton('Discard session changes')!.click());
    expect(actions.onDiscardChanges).toHaveBeenCalledOnce();
  });
  it('opens the commit workflow directly when clicking the commit button', () => {
    const { container } = renderActions({ stagedCount: 1, openMenu: false });
    expect(document.querySelector('[role="dialog"]')).toBeNull();

    act(() => {
      container.querySelector<HTMLButtonElement>('[aria-label="Commit"]')?.click();
    });

    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect(document.querySelector('[aria-label="Commit message"]')).not.toBeNull();
  });

  it('opens a focused commit form without synchronization actions', () => {
    renderActions({ stagedCount: 1 });

    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect(document.querySelector('[aria-label="Commit message"]')).not.toBeNull();
  });

  it('can explicitly include unstaged files in a commit', async () => {
    const { actions, findButton } = renderActions({ unstagedCount: 3 });
    const commit = findButton('Commit');

    expect(commit).toBeDefined();
    await act(async () => {
      commit?.click();
    });
    expect(actions.onCommit).toHaveBeenCalledWith('feat: improve review workflow', true);
    expect(actions.onCommit).toHaveBeenCalledOnce();
  });

  it('shows commit message and change statistics', async () => {
    const { actions, findButton } = renderActions({ stagedCount: 2 });
    const commit = findButton('Commit');

    expect(document.querySelector('[aria-label="Commit message"]')).not.toBeNull();
    expect(document.body.textContent).toContain('+42');
    expect(document.body.textContent).toContain('−11');
    await act(async () => {
      commit?.click();
    });
    expect(actions.onCommit).toHaveBeenCalledOnce();
    expect(actions.onPush).not.toHaveBeenCalled();
  });

  it('offers push before pull request creation when commits are ahead', async () => {
    const { actions, findButton } = renderActions({ aheadCount: 2, openSync: true });
    const push = findButton('Push');

    expect(push).toBeDefined();
    await act(async () => {
      push?.click();
    });
    expect(actions.onPush).toHaveBeenCalledOnce();
    expect(actions.onCreatePullRequest).not.toHaveBeenCalled();
  });

  it('offers pull when the clean branch is behind', async () => {
    const { actions, findButton } = renderActions({ behindCount: 1, openSync: true });
    const pull = findButton('Pull');

    expect(pull).toBeDefined();
    await act(async () => {
      pull?.click();
    });
    expect(actions.onPull).toHaveBeenCalledOnce();
  });

  it('explains why pull request creation is unavailable', () => {
    const blockedReason = 'Pull request creation currently supports GitHub remotes only';
    const { actions, findButton } = renderActions({ blockedReason, openCommitDialog: false });
    const createPullRequest = findButton('Create pull request');

    expect(createPullRequest?.disabled).toBe(true);
    expect(createPullRequest?.title).toBe(blockedReason);
    act(() => createPullRequest?.click());
    expect(actions.onCreatePullRequest).not.toHaveBeenCalled();
  });
});

it('fetches remote changes from the Git menu without requiring a behind count', async () => {
  const { actions, findButton } = renderActions({ openCommitDialog: false, openSync: true });
  await act(async () => findButton('Fetch updates')?.click());
  expect(actions.onFetch).toHaveBeenCalledOnce();
});
it('switches branches through a separate workflow', async () => {
  const { actions, findButton } = renderActions({ openCommitDialog: false });
  act(() => findButton('Switch or create branch')?.click());
  await act(async () =>
    Array.from(document.querySelectorAll('[role="dialog"] button'))
      .find((button) => button.textContent === 'main')
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true })),
  );
  expect(actions.onSwitchBranch).toHaveBeenCalledWith('main');
});
it('makes pushing to the base branch an explicit preference', async () => {
  const { actions, findButton } = renderActions({
    aheadCount: 1,
    isBaseBranch: true,
    openSync: true,
  });
  expect(findButton('Push')?.disabled).toBe(true);
  const checkbox = Array.from(document.querySelectorAll('input')).find((input) =>
    input.parentElement?.textContent?.includes('Allow pushing'),
  );
  act(() => checkbox?.click());
  expect(localStorage.getItem('agentctl.allowBaseBranchPush')).toBe('true');
  await act(async () => findButton('Push')?.click());
  expect(actions.onPush).toHaveBeenCalledOnce();
});

it('generates a blank commit message before committing and preserves the generated body', async () => {
  generation.generate.mockResolvedValue({
    title: 'feat: generated change',
    body: 'Explain the change',
  });
  const { actions } = renderActions({
    sessionId: 'session',
    stagedCount: 1,
    commitMessage: '',
    openCommitDialog: true,
  });
  const commit = Array.from(document.querySelectorAll('button')).find(
    (node) =>
      node.textContent?.trim().startsWith('Commit') &&
      !node.textContent?.includes('push') &&
      node.textContent?.includes('↵'),
  )!;
  await act(async () => commit.click());
  expect(generation.generate).toHaveBeenCalledWith('session', {
    kind: 'commit',
    includeUnstaged: true,
  });
  expect(actions.onCommit).toHaveBeenCalledWith(
    'feat: generated change\n\nExplain the change',
    true,
  );
});
it('keeps the commit dialog open and does not mutate Git when generation fails', async () => {
  generation.generate.mockRejectedValue(new Error('Provider is offline'));
  const { actions } = renderActions({
    sessionId: 'session',
    stagedCount: 1,
    commitMessage: '',
    openCommitDialog: true,
  });
  const commit = Array.from(document.querySelectorAll('button')).find(
    (node) =>
      node.textContent?.trim().startsWith('Commit') &&
      !node.textContent?.includes('push') &&
      node.textContent?.includes('↵'),
  )!;
  await act(async () => commit.click());
  expect(actions.onCommit).not.toHaveBeenCalled();
  expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  expect(document.body.textContent).toContain('Provider is offline');
});

it('uses four labeled controls and removes the ambiguous commit dropdown', () => {
  const { container } = renderActions({ openMenu: false });
  const group = container.querySelector('[aria-label="Git workflow"]')!;
  expect(
    Array.from(group.querySelectorAll('button')).map((button) => button.textContent?.trim()),
  ).toEqual(['Commit', 'Sync', 'Merge…', 'Session']);
  expect(container.querySelector('[aria-label="Git actions"]')).toBeNull();
});
it('offers one commit action and an explicit option to publish afterward', async () => {
  const { actions, findButton } = renderActions({ stagedCount: 1 });
  expect(findButton('Push commits')).toBeUndefined();
  expect(findButton('Pull changes')).toBeUndefined();
  expect(findButton('Commit and push')).toBeUndefined();
  const publish = Array.from(document.querySelectorAll('input')).find((input) =>
    input.parentElement?.textContent?.includes('Push after committing'),
  )!;
  act(() => publish.click());
  await act(async () => findButton('Commit and push')!.click());
  expect(actions.onCommit).toHaveBeenCalledOnce();
  expect(actions.onPush).toHaveBeenCalledOnce();
  expect(actions.onCommit.mock.invocationCallOrder[0]).toBeLessThan(
    actions.onPush.mock.invocationCallOrder[0],
  );
});
it('shows push recovery after committing succeeds but pushing fails', async () => {
  const { actions, findButton } = renderActions({ stagedCount: 1 });
  actions.onPush.mockRejectedValue(new Error('Remote unavailable'));
  const publish = Array.from(document.querySelectorAll('input')).find((input) =>
    input.parentElement?.textContent?.includes('Push after committing'),
  )!;
  act(() => publish.click());
  await act(async () => findButton('Commit and push')!.click());
  expect(document.querySelector('[data-slot="dialog-content"]')).not.toBeNull();
  expect(document.body.textContent).toContain('Commit succeeded, but push failed');
});

it('lets users close Sync while fetching and still reports a failure', async () => {
  const { container, actions, findButton } = renderActions({ openSync: true });
  let reject!: (error: Error) => void;
  actions.onFetch.mockImplementation(
    () =>
      new Promise((_resolve, fail) => {
        reject = fail;
      }),
  );
  act(() => findButton('Fetch updates')!.click());
  act(() => container.querySelector<HTMLButtonElement>('[aria-label="Sync"]')!.click());
  expect(document.querySelector('[data-slot="popover-content"]')).toBeNull();
  expect(document.body.textContent).toContain('Fetching remote updates');
  await act(async () => reject(new Error('Remote unavailable')));
  expect(document.querySelector('[role="alert"]')?.textContent).toBe('Remote unavailable');
});

it('retries only pushing after a successful commit, even after the file counts and message reset', async () => {
  const { actions, findButton, rerender } = renderActions({ stagedCount: 1 });
  actions.onPush
    .mockRejectedValueOnce(new Error('Remote unavailable'))
    .mockResolvedValue(undefined);
  const publish = Array.from(document.querySelectorAll('input')).find((input) =>
    input.parentElement?.textContent?.includes('Push after committing'),
  )!;
  act(() => publish.click());
  await act(async () => findButton('Commit and push')!.click());
  rerender({ stagedCount: 0, commitMessage: '', aheadCount: 1 });
  expect(findButton('Retry push')?.disabled).toBe(false);
  expect(document.body.textContent).toContain('saved locally');
  await act(async () => findButton('Retry push')!.click());
  expect(actions.onCommit).toHaveBeenCalledOnce();
  expect(actions.onPush).toHaveBeenCalledTimes(2);
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(document.body.textContent).toContain('Commits pushed to the remote');
});
it('preserves Sync failure feedback when reopening and clears it after retry succeeds', async () => {
  const { container, actions, findButton } = renderActions({ openSync: true });
  actions.onFetch
    .mockRejectedValueOnce(new Error('Remote unavailable'))
    .mockResolvedValue(undefined);
  await act(async () => findButton('Fetch updates')!.click());
  act(() => container.querySelector<HTMLButtonElement>('[aria-label="Sync"]')!.click());
  act(() => container.querySelector<HTMLButtonElement>('[aria-label="Sync"]')!.click());
  expect(document.querySelector('[role="alert"]')?.textContent).toBe('Remote unavailable');
  await act(async () => findButton('Fetch updates')!.click());
  expect(actions.onFetch).toHaveBeenCalledTimes(2);
  expect(document.querySelector('[role="alert"]')).toBeNull();
  expect(document.body.textContent).toContain('Remote information refreshed');
});
it('keeps a manual commit draft across closing and reopening, and retries a failed commit', async () => {
  const { container, actions, findButton } = renderActions({
    stagedCount: 1,
    commitMessage: 'Keep my draft',
  });
  actions.onCommit.mockRejectedValueOnce(new Error('Hook failed')).mockResolvedValue(undefined);
  await act(async () => findButton('Commit')!.click());
  expect(document.querySelector<HTMLTextAreaElement>('[aria-label="Commit message"]')?.value).toBe(
    'Keep my draft',
  );
  act(() => findButton('Cancel')!.click());
  act(() => container.querySelector<HTMLButtonElement>('[aria-label="Commit"]')!.click());
  expect(document.querySelector<HTMLTextAreaElement>('[aria-label="Commit message"]')?.value).toBe(
    'Keep my draft',
  );
  await act(async () => findButton('Commit')!.click());
  expect(actions.onCommit).toHaveBeenNthCalledWith(2, 'Keep my draft', true);
});

it('clears commit push recovery when publication succeeds through Sync instead', async () => {
  const { container, actions, findButton, rerender } = renderActions({ stagedCount: 1 });
  actions.onPush
    .mockRejectedValueOnce(new Error('Remote unavailable'))
    .mockResolvedValue(undefined);
  const publish = Array.from(document.querySelectorAll('input')).find((input) =>
    input.parentElement?.textContent?.includes('Push after committing'),
  )!;
  act(() => publish.click());
  await act(async () => findButton('Commit and push')!.click());
  rerender({ stagedCount: 0, commitMessage: '', aheadCount: 1 });
  act(() => findButton('Cancel')!.click());
  act(() => container.querySelector<HTMLButtonElement>('[aria-label="Sync"]')!.click());
  await act(async () => findButton('Push commits')!.click());
  rerender({ aheadCount: 0 });
  act(() => container.querySelector<HTMLButtonElement>('[aria-label="Commit"]')!.click());
  expect(findButton('Retry push')).toBeUndefined();
  expect(actions.onCommit).toHaveBeenCalledOnce();
  expect(actions.onPush).toHaveBeenCalledTimes(2);
});
