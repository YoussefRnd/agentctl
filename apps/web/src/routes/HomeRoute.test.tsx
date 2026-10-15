import { act, type ReactNode, type ChangeEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { HomeRoute } from './HomeRoute';
import { useDraftStore, type ComposerState } from '@/features/composer';
import type { ProviderDiscovery } from '@agentctl/shared';

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  input: vi.fn(),
  patch: vi.fn(),
  upload: vi.fn(),
  open: vi.fn(),
}));
vi.mock('@agentctl/api-client', async (original) => ({
  ...(await original<typeof import('@agentctl/api-client')>()),
  createProjectSession: mocks.create,
  uploadAttachment: mocks.upload,
  openProjectFolder: mocks.open,
  api: { sendInput: mocks.input, patchSession: mocks.patch },
}));
vi.mock('@/app/shell', () => ({
  AppShell: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Sidebar: () => null,
}));
vi.mock('@/features/projects', () => ({
  projectQueries: {
    all: () => ({
      queryKey: ['projects'],
      queryFn: async () => [
        {
          id: 'one',
          name: 'One',
          isGitRepo: true,
          sessions: [{ id: 'old-empty', status: 'idle', hasUserActivity: false }],
        },
        { id: 'two', name: 'Two', isGitRepo: true, sessions: [] },
        { id: 'plain', name: 'Plain', isGitRepo: false, sessions: [] },
      ],
    }),
  },
  DirectoryExplorer: ({ onSelect }: { onSelect: (path: string) => void }) => (
    <button onClick={() => onSelect('/new/folder')}>Open folder</button>
  ),
}));
vi.mock('@/features/conversation', () => ({
  NewSessionEmptyState: ({
    children,
    onSelectProject,
    onOpenDirectory,
  }: {
    children: ReactNode;
    onSelectProject: (id: string) => void;
    onOpenDirectory: () => void;
  }) => (
    <div>
      <button onClick={() => onSelectProject('one')}>One</button>
      <button onClick={() => onSelectProject('two')}>Two</button>
      <button onClick={onOpenDirectory}>Browse</button>
      {children}
    </div>
  ),
}));
vi.mock('@/features/providers', () => ({
  useProviders: () => ({
    providers: [
      {
        id: 'provider',
        label: 'Provider',
        status: 'ready',
        installState: 'installed_local',
        modes: ['build'],
        configOptions: [
          { id: 'model', currentValue: 'default' },
          {
            id: 'effort',
            name: 'Effort',
            category: 'thought_level',
            type: 'select',
            currentValue: 'default',
            options: ['none', 'low', 'medium', 'high', 'xhigh', 'max', 'default'].map((value) => ({
              value,
              name: value === 'default' ? 'Default' : value,
            })),
          },
        ],
        features: {
          sessions: { resume: false, fork: false, delete: false, list: false },
          prompts: { image: true, audio: false, embeddedContext: false },
          configuration: { model: true, options: true },
          authentication: { logout: false },
        },
      } as ProviderDiscovery,
    ],
    isLoadingProviders: false,
  }),
  ProviderAuthDialog: () => null,
}));
vi.mock('@/features/settings', async (original) => ({
  ...(await original<typeof import('@/features/settings')>()),
  useSettings: () => ({
    settings: { defaultProviderId: 'provider', defaultToWorktree: true },
    isLoading: false,
  }),
}));
vi.mock('@/features/composer/ui/ComposerInput', () => ({
  ComposerInput: ({ state, children }: { state: ComposerState; children: ReactNode }) => (
    <div data-testid="composer-box">
      <textarea value={state.input} readOnly />
      <button onClick={() => state.handleInputChange('Draft message')}>Type</button>
      <button
        onClick={() =>
          state.handleFileInputChange({
            target: { files: [new File(['x'], 'image.png', { type: 'image/png' })], value: '' },
          } as unknown as ChangeEvent<HTMLInputElement>)
        }
      >
        Attach
      </button>
      <span data-files>{state.attachments.length}</span>
      {children}
    </div>
  ),
}));
vi.mock('@/features/composer/ui/ProviderConfigurator', () => ({
  ProviderPickerTrigger: ({
    handleProviderSelect,
  }: {
    handleProviderSelect: (provider: string, model: string) => void;
  }) => <button onClick={() => handleProviderSelect('provider', 'model-2')}>Change model</button>,
}));
vi.mock('@/features/composer/ui/CommandDropdown', () => ({
  CommandDropdown: ({
    value,
    options,
    onChange,
  }: {
    value: string;
    options: { value: string; label: string }[];
    onChange: (value: string) => void;
  }) => (
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
}));
vi.mock('@/features/composer/ui/SessionController', () => ({
  SubmitButton: ({ canSend, onSubmit }: { canSend: boolean; onSubmit: () => void }) => (
    <button disabled={!canSend} onClick={onSubmit}>
      Send
    </button>
  ),
}));
let root: ReturnType<typeof createRoot>;
let container: HTMLDivElement;
let client: QueryClient;
async function click(text: string) {
  await act(async () => {
    const button = [...container.querySelectorAll('button')].find(
      (b) => b.textContent === text || b.getAttribute('aria-label') === `Thinking effort: ${text}`,
    );
    expect(button).toBeDefined();
    button!.click();
  });
}
beforeEach(async () => {
  vi.resetAllMocks();
  useDraftStore.setState({
    homeDrafts: {},
    sessionDrafts: {},
    pendingComposerInsert: null,
    pendingContextItem: null,
  });
  URL.createObjectURL = vi.fn(() => 'blob:mock');
  URL.revokeObjectURL = vi.fn();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <HomeRoute />
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  expect(container.querySelector('textarea')).not.toBeNull();
});
afterEach(() => {
  act(() => root.unmount());
  client.clear();
  container.remove();
});

it('keeps model changes, text, and attachments local and preserves them across folder switches', async () => {
  await click('Change model');
  await click('Type');
  await click('Attach');
  expect(useDraftStore.getState().homeDrafts.one.selectedModel).toBe('model-2');
  await click('Two');
  expect(container.querySelector('textarea')!.value).toBe('');
  await click('One');
  expect(container.querySelector('textarea')!.value).toBe('Draft message');
  expect(container.querySelector('[data-files]')!.textContent).toBe('1');
  expect(mocks.create).not.toHaveBeenCalled();
  expect(mocks.patch).not.toHaveBeenCalled();
  expect(mocks.input).not.toHaveBeenCalled();
  expect(mocks.upload).not.toHaveBeenCalled();
});
it('places the worktree selector below the composer and uses its selected mode', async () => {
  const modeSelect = [...container.querySelectorAll('select')].find((select) =>
    [...select.options].some((option) => option.value === 'worktree'),
  );
  expect(modeSelect).toBeDefined();
  expect(modeSelect?.closest('[data-testid="composer-box"]')).toBeNull();

  const approvalSelect = [...container.querySelectorAll('select')].find((select) =>
    [...select.options].some((option) => option.value === 'auto_approve'),
  );
  expect(approvalSelect?.parentElement).toBe(modeSelect?.parentElement);
  await act(async () => {
    approvalSelect!.value = 'auto_approve';
    approvalSelect!.dispatchEvent(new Event('change', { bubbles: true }));
  });
  expect(useDraftStore.getState().homeDrafts.one.approvalMode).toBe('auto_approve');

  await act(async () => {
    modeSelect!.value = 'local';
    modeSelect!.dispatchEvent(new Event('change', { bubbles: true }));
  });
  expect(useDraftStore.getState().homeDrafts.one.mode).toBe('local');

  mocks.create.mockResolvedValue({ id: 'fresh', selectedProvider: 'provider' });
  mocks.input.mockResolvedValue({ status: 200, body: { eventId: 9 } });
  await click('Type');
  await click('Send');
  expect(mocks.create).toHaveBeenCalledWith(
    'one',
    'local',
    'provider',
    expect.objectContaining({ approvalMode: 'auto_approve' }),
  );
});

it('ignores persisted empty sessions and creates on first Send with the selected model', async () => {
  mocks.create.mockResolvedValue({ id: 'fresh', selectedProvider: 'provider' });
  mocks.input.mockResolvedValue({ status: 200, body: { eventId: 7 } });
  await click('Change model');
  await click('Type');
  await click('Send');
  expect(mocks.create).toHaveBeenCalledExactlyOnceWith(
    'one',
    'worktree',
    'provider',
    expect.objectContaining({
      selectedModel: 'model-2',
      agentPersona: 'build',
      selectedThinkingEffort: 'default',
      approvalMode: 'review',
    }),
  );
  expect(mocks.input).toHaveBeenCalledExactlyOnceWith({
    params: { id: 'fresh' },
    body: { input: 'Draft message', clientMessageId: expect.any(String) },
  });
});
it('keeps the text and attached files visible when startup fails', async () => {
  mocks.create.mockRejectedValue(new Error('git failure'));
  await click('Type');
  await click('Attach');
  await click('Send');
  expect(mocks.create).toHaveBeenCalledTimes(1);
  expect(container.querySelector('textarea')!.value).toBe('Draft message');
  expect(container.querySelector('[data-files]')!.textContent).toBe('1');
});
it('opens a folder without opening a session', async () => {
  mocks.open.mockResolvedValue({ id: 'two' });
  await click('Browse');
  await click('Open folder');
  expect(mocks.open).toHaveBeenCalledExactlyOnceWith('/new/folder');
  expect(mocks.create).not.toHaveBeenCalled();
});

it('opens the workspace selected by a new-session entry point without creating until Send', async () => {
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <MemoryRouter key="target" initialEntries={['/?project=two']}>
          <HomeRoute />
        </MemoryRouter>
      </QueryClientProvider>,
    ),
  );
  expect(mocks.create).not.toHaveBeenCalled();
  mocks.create.mockResolvedValue({ id: 'fresh', selectedProvider: 'provider' });
  mocks.input.mockResolvedValue({ status: 200, body: { eventId: 8 } });
  await click('Type');
  await click('Send');
  expect(mocks.create).toHaveBeenCalledExactlyOnceWith(
    'two',
    'worktree',
    'provider',
    expect.any(Object),
  );
});

it('uses Local for a non-Git workspace and does not offer Worktree', async () => {
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <MemoryRouter key="plain" initialEntries={['/?project=plain']}>
          <HomeRoute />
        </MemoryRouter>
      </QueryClientProvider>,
    ),
  );

  const modeSelect = [...container.querySelectorAll('select')].find((select) =>
    [...select.options].some((option) => option.value === 'local'),
  );
  expect(modeSelect?.value).toBe('local');
  expect([...modeSelect!.options].some((option) => option.value === 'worktree')).toBe(false);

  mocks.create.mockResolvedValue({ id: 'fresh', selectedProvider: 'provider' });
  mocks.input.mockResolvedValue({ status: 200, body: { eventId: 10 } });
  await click('Type');
  await click('Send');
  expect(mocks.create).toHaveBeenCalledWith('plain', 'local', 'provider', expect.any(Object));
});

it('uses the shared slider with all advertised thinking levels and keeps changes local', async () => {
  await click('Default');
  const slider = document.querySelector<HTMLInputElement>(
    'input[aria-label="Thinking effort level"]',
  )!;
  expect(slider.max).toBe('6');
  expect(slider.getAttribute('aria-valuetext')).toBe('Default');
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(slider, '4');
    slider.dispatchEvent(new Event('input', { bubbles: true }));
    slider.dispatchEvent(new Event('change', { bubbles: true }));
  });
  expect(useDraftStore.getState().homeDrafts.one.thinkingConfig).toEqual({
    id: 'effort',
    value: 'xhigh',
  });
  expect(mocks.create).not.toHaveBeenCalled();
  expect(mocks.patch).not.toHaveBeenCalled();
  expect(mocks.input).not.toHaveBeenCalled();
});
