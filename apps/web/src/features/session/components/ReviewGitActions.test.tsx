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
});

function renderActions(
  options: {
    stagedCount?: number;
    unstagedCount?: number;
    aheadCount?: number;
    behindCount?: number;
    hasUpstream?: boolean;
    blockedReason?: string;
    openMenu?: boolean;
    openCommitDialog?: boolean;
  } = {},
) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  const actions = {
    onCommit: vi.fn().mockResolvedValue(undefined),
    onStageAll: vi.fn().mockResolvedValue(undefined),
    onPush: vi.fn().mockResolvedValue(undefined),
    onPull: vi.fn().mockResolvedValue(undefined),
    onCreatePullRequest: vi.fn(),
  };

  act(() => {
    root.render(
      <ReviewGitActions
        branch="feature/review"
        branches={['main', 'feature/review']}
        remoteName="origin"
        hasBranchChanges
        stagedCount={options.stagedCount ?? 0}
        unstagedCount={options.unstagedCount ?? 0}
        additions={42}
        deletions={11}
        aheadCount={options.aheadCount ?? 0}
        behindCount={options.behindCount ?? 0}
        hasUpstream={options.hasUpstream ?? true}
        isBaseBranch={false}
        canPush
        isLoadingGitStatus={false}
        commitMessage="feat: improve review workflow"
        onCommitMessageChange={vi.fn()}
        onSwitchBranch={vi.fn().mockResolvedValue(undefined)}
        onCommit={actions.onCommit}
        onStageAll={actions.onStageAll}
        onPush={actions.onPush}
        onPull={actions.onPull}
        onOpenPullRequestDialog={actions.onCreatePullRequest}
        pullRequestBlockedReason={options.blockedReason}
        onApplySession={vi.fn()}
        onDiscardChanges={vi.fn()}
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
    expect(actions.onStageAll).toHaveBeenCalledOnce();
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
