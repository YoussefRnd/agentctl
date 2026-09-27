import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import type { SessionRow } from '@agentctl/shared';
import { useHomeSessionStart, type HomeSessionSelection } from './useHomeSessionStart';
import { useDraftStore } from './useDraftStore';
import { sessionKeys } from '@/shared/lib/queryKeys';

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  upload: vi.fn(),
  input: vi.fn(),
  patch: vi.fn(),
  started: vi.fn(),
  error: vi.fn(),
}));
vi.mock('@agentctl/api-client', () => ({
  createProjectSession: mocks.create,
  uploadAttachment: mocks.upload,
  api: { sendInput: mocks.input, patchSession: mocks.patch },
}));
vi.mock('sonner', () => ({ toast: { error: mocks.error } }));
const selection: HomeSessionSelection = {
  providerId: 'provider',
  mode: 'worktree',
  selectedModel: 'model-2',
  selectedThinkingEffort: 'high',
  approvalMode: 'auto_approve',
  agentPersona: 'build',
};
const session = {
  id: 'new-session',
  projectId: 'project',
  selectedProvider: 'provider',
  mode: 'worktree',
  selectedModel: 'model-2',
  selectedThinkingEffort: 'high',
  approvalMode: 'auto_approve',
  agentPersona: 'build',
  status: 'idle',
} as SessionRow;
let hook: ReturnType<typeof useHomeSessionStart>;
let root: ReturnType<typeof createRoot>;
let client: QueryClient;
function Harness() {
  hook = useHomeSessionStart(mocks.started);
  return null;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

beforeEach(async () => {
  vi.resetAllMocks();
  useDraftStore.setState({ homeDrafts: {}, sessionDrafts: {} });
  mocks.create.mockResolvedValue(session);
  mocks.input.mockResolvedValue({ status: 200, body: { eventId: 42 } });
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  root = createRoot(document.createElement('div'));
  await act(async () =>
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

describe('Home first Send', () => {
  it('does nothing on mount or an empty Send', async () => {
    expect(mocks.create).not.toHaveBeenCalled();
    await act(async () =>
      expect(await hook.startSession('project', ' ', [], selection)).toBe(false),
    );
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it('creates once with the chosen settings, and navigates only after message acceptance', async () => {
    const accepted = deferred<{ status: number; body: { eventId: number } }>();
    mocks.input.mockReturnValue(accepted.promise);
    let pending!: Promise<boolean>;
    await act(async () => {
      pending = hook.startSession('project', 'hello', [], selection);
    });
    expect(mocks.create).toHaveBeenCalledExactlyOnceWith('project', 'worktree', 'provider', {
      selectedModel: 'model-2',
      selectedThinkingEffort: 'high',
      approvalMode: 'auto_approve',
      agentPersona: 'build',
    });
    expect(mocks.started).not.toHaveBeenCalled();
    await act(async () =>
      expect(await hook.startSession('project', 'hello', [], selection)).toBe(false),
    );
    expect(mocks.create).toHaveBeenCalledTimes(1);
    await act(async () => {
      accepted.resolve({ status: 200, body: { eventId: 42 } });
      expect(await pending).toBe(true);
    });
    expect(mocks.started).toHaveBeenCalledExactlyOnceWith('new-session');
    expect(client.getQueryData(sessionKeys.events('new-session'))).toEqual([
      expect.objectContaining({
        id: 42,
        data: { role: 'user', content: 'hello', attachmentIds: [] },
      }),
    ]);
    expect(useDraftStore.getState().homeDrafts.project).toBeUndefined();
  });
  it('retains the draft after creation failure', async () => {
    useDraftStore.getState().setSessionDraft('home:project', 'hello');
    mocks.create.mockRejectedValueOnce(new Error('git failed'));
    await act(async () =>
      expect(await hook.startSession('project', 'hello', [], selection)).toBe(false),
    );
    expect(useDraftStore.getState().sessionDrafts['home:project']).toBe('hello');
    expect(mocks.input).not.toHaveBeenCalled();
    expect(mocks.started).not.toHaveBeenCalled();
  });
  it('retries partial uploads using the same session and already uploaded files', async () => {
    const first = new File(['a'], 'first.png', { type: 'image/png' });
    const second = new File(['b'], 'second.png', { type: 'image/png' });
    useDraftStore.getState().updateHomeDraft('project', { files: [first, second] });
    useDraftStore.getState().setSessionDraft('home:project', 'images');
    mocks.upload
      .mockResolvedValueOnce({ attachmentId: 'att-1' })
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ attachmentId: 'att-2' });
    await act(async () =>
      expect(await hook.startSession('project', 'images', [first, second], selection)).toBe(false),
    );
    expect(mocks.input).not.toHaveBeenCalled();
    expect(useDraftStore.getState().sessionDrafts['home:project']).toBe('images');
    expect(useDraftStore.getState().homeDrafts.project.files).toEqual([first, second]);
    await act(async () =>
      expect(await hook.startSession('project', 'images', [first, second], selection)).toBe(true),
    );
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(mocks.patch).not.toHaveBeenCalled();
    expect(mocks.upload.mock.calls).toEqual([
      ['new-session', first],
      ['new-session', second],
      ['new-session', second],
    ]);
    expect(mocks.input).toHaveBeenCalledExactlyOnceWith({
      params: { id: 'new-session' },
      body: { input: 'images', attachmentIds: ['att-1', 'att-2'] },
    });
  });
  it('reuses the session after input rejection and applies any revised settings', async () => {
    mocks.input.mockResolvedValueOnce({ status: 409, body: { message: 'busy' } });
    await act(async () =>
      expect(await hook.startSession('project', 'hello', [], selection)).toBe(false),
    );
    expect(mocks.started).not.toHaveBeenCalled();
    mocks.patch.mockResolvedValue({
      status: 200,
      body: { session: { ...session, selectedModel: 'model-3' } },
    });
    await act(async () =>
      expect(
        await hook.startSession('project', 'hello', [], { ...selection, selectedModel: 'model-3' }),
      ).toBe(true),
    );
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(mocks.patch).toHaveBeenCalledWith({
      params: { id: 'new-session' },
      body: expect.objectContaining({ modelId: 'model-3' }),
    });
    expect(mocks.input).toHaveBeenCalledTimes(2);
  });
  it('applies provider-specific thinking after creation and before the first message', async () => {
    const chosen = { ...selection, thinkingConfig: { id: 'effort', value: 'xhigh' } };
    useDraftStore.getState().updateHomeDraft('project', { thinkingConfig: chosen.thinkingConfig });
    mocks.patch.mockImplementation(async () => {
      expect(mocks.create).toHaveBeenCalledTimes(1);
      expect(mocks.input).not.toHaveBeenCalled();
      return { status: 200, body: { session } };
    });
    await act(async () =>
      expect(await hook.startSession('project', 'hello', [], chosen)).toBe(true),
    );
    expect(mocks.create.mock.calls[0][3]).not.toHaveProperty('thinkingConfig');
    expect(mocks.patch).toHaveBeenCalledExactlyOnceWith({
      params: { id: 'new-session' },
      body: {
        providerId: 'provider',
        modelId: 'model-2',
        thinkingEffort: 'high',
        configId: 'effort',
        configValue: 'xhigh',
      },
    });
    expect(mocks.input).toHaveBeenCalledTimes(1);
  });
  it('retains the provider-specific thinking choice and session when applying it fails', async () => {
    const chosen = { ...selection, thinkingConfig: { id: 'effort', value: 'default' } };
    useDraftStore.getState().updateHomeDraft('project', { thinkingConfig: chosen.thinkingConfig });
    mocks.patch
      .mockResolvedValueOnce({ status: 409, body: { message: 'Unavailable' } })
      .mockResolvedValueOnce({ status: 200, body: { session } });
    await act(async () =>
      expect(await hook.startSession('project', 'hello', [], chosen)).toBe(false),
    );
    expect(mocks.input).not.toHaveBeenCalled();
    expect(useDraftStore.getState().homeDrafts.project.thinkingConfig).toEqual(
      chosen.thinkingConfig,
    );
    await act(async () =>
      expect(await hook.startSession('project', 'hello', [], chosen)).toBe(true),
    );
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(mocks.input).toHaveBeenCalledTimes(1);
  });
  it('uses the advertised option when revising thinking after a rejected first message', async () => {
    mocks.patch.mockResolvedValue({ status: 200, body: { session } });
    mocks.input.mockResolvedValueOnce({ status: 409, body: { message: 'busy' } });
    await act(async () =>
      expect(
        await hook.startSession('project', 'hello', [], {
          ...selection,
          thinkingConfig: { id: 'effort', value: 'high' },
        }),
      ).toBe(false),
    );
    await act(async () =>
      expect(
        await hook.startSession('project', 'hello', [], {
          ...selection,
          selectedThinkingEffort: 'medium',
          thinkingConfig: { id: 'effort', value: 'default' },
        }),
      ).toBe(true),
    );
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(mocks.patch).toHaveBeenCalledTimes(2);
    expect(mocks.patch).toHaveBeenLastCalledWith({
      params: { id: 'new-session' },
      body: {
        providerId: 'provider',
        modelId: 'model-2',
        thinkingEffort: 'high',
        configId: 'effort',
        configValue: 'default',
      },
    });
  });
});
