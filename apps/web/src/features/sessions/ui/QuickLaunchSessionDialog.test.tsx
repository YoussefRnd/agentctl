import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { QuickLaunchSessionDialog } from './QuickLaunchSessionDialog';
import { useDraftStore } from '@/features/composer';
const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  closed: vi.fn(),
  providers: [
    {
      id: 'provider',
      label: 'Provider',
      installState: 'installed_local',
      configOptions: [
        {
          id: 'model',
          options: [
            { value: 'default', name: 'Default' },
            { value: 'custom-model', name: 'Custom Model' },
          ],
        },
      ],
    },
  ],
}));
vi.mock('@agentctl/api-client', async (original) => ({
  ...(await original<typeof import('@agentctl/api-client')>()),
  createProjectSession: mocks.create,
}));
vi.mock('@/features/providers', () => ({ useProviders: () => ({ providers: mocks.providers }) }));
vi.mock('@/features/settings', () => ({
  useSettings: () => ({ settings: { defaultProviderId: 'provider', defaultToWorktree: true } }),
}));
vi.mock('@agentctl/ui', async (original) => ({
  ...(await original<typeof import('@agentctl/ui')>()),
  Dialog: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
  DialogDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>,
  Select: ({
    options,
    value,
    onChange,
  }: {
    options: { value: string; label: string }[];
    value: string;
    onChange: (v: string) => void;
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
let root: ReturnType<typeof createRoot>;
let container: HTMLDivElement;
function Location() {
  const location = useLocation();
  return (
    <output>
      {location.pathname}
      {location.search}
    </output>
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  useDraftStore.setState({ homeDrafts: {}, sessionDrafts: {} });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});
it('prepares a Home draft with the chosen model, effort, and mode without creating a session', async () => {
  await act(async () =>
    root.render(
      <MemoryRouter initialEntries={['/sessions/existing']}>
        <QuickLaunchSessionDialog
          open
          onClose={mocks.closed}
          projectId="project"
          projectName="Project"
          defaultMode="local"
        />
        <Location />
      </MemoryRouter>,
    ),
  );
  expect(mocks.create).not.toHaveBeenCalled();
  await act(async () => {
    const selects = container.querySelectorAll('select');
    selects[1].value = 'custom-model';
    selects[1].dispatchEvent(new Event('change', { bubbles: true }));
    selects[2].value = 'high';
    selects[2].dispatchEvent(new Event('change', { bubbles: true }));
  });
  await act(async () =>
    container
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
  );
  expect(useDraftStore.getState().homeDrafts.project).toMatchObject({
    providerId: 'provider',
    selectedModel: 'custom-model',
    selectedThinkingEffort: 'high',
    mode: 'local',
  });
  expect(container.querySelector('output')!.textContent).toBe('/?project=project');
  expect(mocks.closed).toHaveBeenCalledTimes(1);
  expect(mocks.create).not.toHaveBeenCalled();
});

it('uses Local and hides Worktree for a non-Git project', async () => {
  await act(async () =>
    root.render(
      <MemoryRouter>
        <QuickLaunchSessionDialog
          open
          onClose={mocks.closed}
          projectId="plain"
          projectName="Plain"
          defaultMode="worktree"
          allowWorktree={false}
        />
      </MemoryRouter>,
    ),
  );

  expect(container.textContent).not.toContain('Worktree (Branch)');
  await act(async () =>
    container
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
  );
  expect(useDraftStore.getState().homeDrafts.plain.mode).toBe('local');
});
