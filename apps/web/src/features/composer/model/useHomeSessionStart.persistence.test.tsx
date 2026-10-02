import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { sessionRowSchema } from '@agentctl/shared';
import { useMessageQueueStore } from '@/shared/stores/useMessageQueueStore';
import { useDraftStore } from './useDraftStore';
import { useHomeSessionStart } from './useHomeSessionStart';

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  send: vi.fn(),
  patch: vi.fn(),
  upload: vi.fn(),
  started: vi.fn(),
}));
vi.mock('@agentctl/api-client', () => ({
  createProjectSession: mocks.create,
  uploadAttachment: mocks.upload,
  api: { sendInput: mocks.send, patchSession: mocks.patch },
}));
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));
const projectId = '22222222-2222-4222-8222-222222222222';
const session = sessionRowSchema.parse({
  id: '11111111-1111-4111-8111-111111111111',
  projectId,
  agent: 'agent',
  branch: 'main',
  taskSlug: 'task',
  title: 'Task',
  baseCommit: 'none',
  worktreePath: '/tmp/project',
  mode: 'local',
  agentSessionId: null,
  status: 'idle',
  totalTokens: 0,
  contextLimit: 0,
  estimatedCost: 0,
  lastHeartbeat: null,
  closedAt: null,
  lastActivityAt: new Date(),
  createdAt: new Date(),
  updatedAt: new Date(),
  selectedProvider: 'agent',
  selectedModel: 'model',
  selectedThinkingEffort: 'medium',
  approvalMode: 'review',
});
const selection = {
  providerId: 'agent',
  mode: 'local' as const,
  selectedModel: 'model',
  selectedThinkingEffort: 'medium' as const,
  approvalMode: 'review' as const,
};
let root: ReturnType<typeof createRoot>;
let client: QueryClient;
let hook: ReturnType<typeof useHomeSessionStart>;
function Harness() {
  hook = useHomeSessionStart(mocks.started);
  return null;
}
beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  useDraftStore.setState({ homeDrafts: {}, sessionDrafts: {} });
  useMessageQueueStore.getState().clearQueue();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  root = createRoot(document.createElement('div'));
  mocks.create.mockResolvedValue(session);
  act(() =>
    root.render(
      <QueryClientProvider client={client}>
        <Harness />
      </QueryClientProvider>,
    ),
  );
});
afterEach(() => {
  act(() => root.unmount());
  client.clear();
});

it('persists the first message before sending and retains its stable ID on failure', async () => {
  mocks.send.mockImplementation(async ({ body }) => {
    expect(useMessageQueueStore.getState().queuedMessages[session.id][0]).toMatchObject({
      id: body.clientMessageId,
      status: 'sending',
      text: 'hello',
    });
    throw new Error('Lost acknowledgment');
  });
  await act(async () => {
    expect(await hook.startSession(projectId, 'hello', [], selection)).toBe(false);
  });
  const pending = useMessageQueueStore.getState().queuedMessages[session.id][0];
  expect(pending).toMatchObject({ status: 'failed', error: 'Lost acknowledgment' });
  expect(mocks.started).not.toHaveBeenCalled();
  expect(useDraftStore.getState().homeDrafts[projectId].session?.id).toBe(session.id);
  expect(
    JSON.parse(localStorage.getItem('agentctl-message-outbox')!).state.queuedMessages[session.id][0]
      .id,
  ).toBe(pending.id);
});

it('restores a created home session and reuses its pending message instead of creating duplicates', async () => {
  useDraftStore.getState().updateHomeDraft(projectId, { session, ...selection });
  const saved = localStorage.getItem('agentctl-composer-drafts')!;
  useDraftStore.setState({ homeDrafts: {} });
  localStorage.setItem('agentctl-composer-drafts', saved);
  await useDraftStore.persist.rehydrate();
  const id = useMessageQueueStore.getState().enqueueMessage(session.id, 'hello', []);
  mocks.send.mockResolvedValue({ status: 200, body: { eventId: 42, success: true } });
  await act(async () => {
    expect(await hook.startSession(projectId, 'hello', [], selection)).toBe(true);
  });
  expect(mocks.create).not.toHaveBeenCalled();
  expect(mocks.send).toHaveBeenCalledWith({
    params: { id: session.id },
    body: { input: 'hello', clientMessageId: id },
  });
  expect(useMessageQueueStore.getState().queuedMessages[session.id]).toEqual([]);
  expect(useDraftStore.getState().homeDrafts[projectId]).toBeUndefined();
});
