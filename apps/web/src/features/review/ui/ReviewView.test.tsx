import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import { ReviewView } from './ReviewView';
import { useReviewUIStore, type ReviewScope } from '../model/useReviewUIStore';

const fixture = vi.hoisted(() => {
  const file = {
    path: 'terraform-examples/main.tf',
    state: 'untracked',
    diff: '',
    additions: 2,
    deletions: 0,
    sessionAdditions: 0,
    sessionDeletions: 0,
  };
  return {
    file,
    patch: '@@ -0,0 +1,2 @@\n+resource "example" "test" {}\n+output "name" {}',
    getSessionReview: vi.fn(),
    session: {
      reviewData: {
        files: [file],
        capture: {
          currentTree: 'c'.repeat(40),
          workingTree: 'a'.repeat(40),
          sessionTree: 'b'.repeat(40),
        },
      },
      refetchReview: vi.fn(),
      sessionData: { session: { id: 'session-1', status: 'idle' } },
      branches: [],
    },
  };
});
vi.mock('@agentctl/api-client', async (original) => ({
  ...(await original<typeof import('@agentctl/api-client')>()),
  api: { getSessionReview: fixture.getSessionReview },
}));
vi.mock('@/features/sessions', () => ({
  useSession: () => fixture.session,
  useSessionStream: () => ({ events: [] }),
  useOpenWorkspaceFile: () => vi.fn(),
}));
vi.mock('@/features/composer', () => ({ useDraftStore: { getState: vi.fn() } }));
vi.mock('../model/useGitStatus', () => ({
  useGitStatus: () => ({
    gitStatus: {
      isRepo: true,
      branch: 'master',
      hasPrimaryRemote: false,
      aheadCount: 0,
      behindCount: 0,
    },
  }),
}));
vi.mock('./ReviewDialogs', () => ({ ReviewDialogs: () => null }));

const initialStore = useReviewUIStore.getState();
const roots: Root[] = [];
const clients: QueryClient[] = [];
afterEach(() => {
  act(() => roots.splice(0).forEach((root) => root.unmount()));
  clients.splice(0).forEach((client) => client.clear());
  useReviewUIStore.setState(initialStore, true);
  document.body.innerHTML = '';
  fixture.session.reviewData.files = [fixture.file];
  fixture.session.reviewData.capture.currentTree = 'c'.repeat(40);
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

async function renderReview(scope: ReviewScope) {
  fixture.getSessionReview.mockImplementation(async ({ query }: { query: { scope: string } }) => ({
    status: 200,
    // A resumed session's baseline can already contain these untracked files.
    body: { files: [{ ...fixture.file, diff: query.scope === 'working' ? fixture.patch : '' }] },
  }));
  useReviewUIStore
    .getState()
    .setReviewScope(scope, { sessionId: 'session-1', files: [fixture.file.path] });
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(client);
  act(() =>
    root.render(
      <QueryClientProvider client={client}>
        <ReviewView />
      </QueryClientProvider>,
    ),
  );
  act(() => container.querySelector<HTMLButtonElement>('[aria-label^="Toggle diff for"]')?.click());
  await act(async () => {
    await vi.waitFor(() => expect(client.isFetching()).toBe(0));
  });
  return container;
}

it('shows the untracked file patch in Last Turn even when the session baseline contains it', async () => {
  const container = await renderReview('this_turn');
  expect(container.textContent).toContain('resource "example" "test" {}');
  expect(container.textContent).not.toContain('No textual changes in this scope.');
});

it('keeps Branch Changes relative to the session baseline', async () => {
  const container = await renderReview('all_edits');
  expect(container.textContent).toContain('No textual changes in this scope.');
  expect(fixture.getSessionReview).toHaveBeenLastCalledWith(
    expect.objectContaining({
      query: expect.objectContaining({ fromHash: 'b'.repeat(40), toHash: 'c'.repeat(40) }),
    }),
  );
});

it('uses captured scope hashes and reloads expanded files when the capture changes', async () => {
  await renderReview('this_turn');
  expect(fixture.getSessionReview).toHaveBeenLastCalledWith(
    expect.objectContaining({
      query: expect.objectContaining({ fromHash: 'a'.repeat(40), toHash: 'c'.repeat(40) }),
    }),
  );
  const client = clients[0];
  const root = roots[0];
  fixture.session.reviewData.capture = {
    ...fixture.session.reviewData.capture,
    currentTree: 'd'.repeat(40),
  };
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <ReviewView />
      </QueryClientProvider>,
    );
  });
  await act(async () => {
    await vi.waitFor(() => expect(client.isFetching()).toBe(0));
  });
  expect(fixture.getSessionReview).toHaveBeenLastCalledWith(
    expect.objectContaining({
      query: expect.objectContaining({ fromHash: 'a'.repeat(40), toHash: 'd'.repeat(40) }),
    }),
  );
});

it('reuses a captured diff when switching between Working Tree and Last Turn', async () => {
  await renderReview('uncommitted');
  expect(fixture.getSessionReview).toHaveBeenCalledTimes(1);
  await act(async () => {
    useReviewUIStore
      .getState()
      .setReviewScope('this_turn', { sessionId: 'session-1', files: [fixture.file.path] });
  });
  expect(fixture.getSessionReview).toHaveBeenCalledTimes(1);
});
