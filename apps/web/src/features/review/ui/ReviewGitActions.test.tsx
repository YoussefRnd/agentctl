// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ReviewGitActions } from './ReviewGitActions';

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
    openCommitDialog?: boolean;
    commitMessage?: string;
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

  act(() => {
    root.render(
      <ReviewGitActions
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
  });

  if (options.openMenu !== false) {
    act(() => {
      container.querySelector<HTMLButtonElement>('[aria-label="Git actions"]')?.click();
    });
  }

  const findButton = (text: string) =>
    Array.from(document.querySelectorAll('button')).find((button) =>
      button.textContent?.includes(text),
    );

  if (options.openMenu !== false && options.openCommitDialog !== false) {
    act(() => {
      findButton('Commit or push')?.click();
    });
  }

  return { container, actions, findButton };
}

describe('ReviewGitActions', () => {
  it('requires an explicit commit message', async () => {
    const { actions, findButton } = renderActions({ stagedCount: 1, commitMessage: '' });
    expect(findButton('Commit')?.disabled).toBe(true);
    expect(findButton('Commit and push')?.disabled).toBe(true);
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

  it('exposes apply and discard through the git menu', () => {
    const { actions, findButton } = renderActions({ openCommitDialog: false });
    act(() => findButton('Apply session changes')?.click());
    expect(actions.onApplySession).toHaveBeenCalledOnce();
    act(() => document.querySelector<HTMLButtonElement>('[aria-label="Git actions"]')?.click());
    act(() => findButton('Discard session changes')?.click());
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

  it('opens the commit workflow in a dialog from the compact menu', () => {
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
    expect(document.body.textContent).toContain('-11');
    await act(async () => {
      commit?.click();
    });
    expect(actions.onCommit).toHaveBeenCalledOnce();
    expect(actions.onPush).not.toHaveBeenCalled();
  });

  it('offers push before pull request creation when commits are ahead', async () => {
    const { actions, findButton } = renderActions({ aheadCount: 2 });
    const push = findButton('Push');

    expect(push).toBeDefined();
    await act(async () => {
      push?.click();
    });
    expect(actions.onPush).toHaveBeenCalledOnce();
    expect(actions.onCreatePullRequest).not.toHaveBeenCalled();
  });

  it('offers pull when the clean branch is behind', async () => {
    const { actions, findButton } = renderActions({ behindCount: 1 });
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
  const { actions, findButton } = renderActions({ openCommitDialog: false });
  await act(async () => findButton('Fetch remote changes')?.click());
  expect(actions.onFetch).toHaveBeenCalledOnce();
});
it('switches branches through a separate workflow', async () => {
  const { actions, findButton } = renderActions({ openCommitDialog: false });
  act(() => findButton('Switch or create branch')?.click());
  await act(async () => findButton('main')?.click());
  expect(actions.onSwitchBranch).toHaveBeenCalledWith('main');
});
it('makes pushing to the base branch an explicit preference', async () => {
  const { actions, findButton } = renderActions({ aheadCount: 1, isBaseBranch: true });
  expect(findButton('Push')?.disabled).toBe(true);
  const checkbox = Array.from(document.querySelectorAll('input')).find((input) =>
    input.parentElement?.textContent?.includes('Allow pushing'),
  );
  act(() => checkbox?.click());
  expect(localStorage.getItem('agentctl.allowBaseBranchPush')).toBe('true');
  await act(async () => findButton('Push')?.click());
  expect(actions.onPush).toHaveBeenCalledOnce();
});
