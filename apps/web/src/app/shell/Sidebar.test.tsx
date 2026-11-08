import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { expect, it, vi } from 'vite-plus/test';
import { Sidebar } from './Sidebar';

vi.mock('../session/QuickLaunchSessionDialog', () => ({ QuickLaunchSessionDialog: () => null }));

it('filters the project list without hiding activity from the native tray', async () => {
  const updateTrayStatus = vi.fn();
  vi.stubGlobal('electronAPI', { updateTrayStatus });
  const projects = [
    {
      id: 'repository',
      name: 'Git workspace',
      path: '/workspace/repository',
      isGitRepo: true,
      sessions: [{ id: 'waiting', status: 'needs_attention' }],
    },
    {
      id: 'folder',
      name: 'Local folder',
      path: '/workspace/folder',
      isGitRepo: false,
      sessions: [{ id: 'running', status: 'running' }],
    },
  ];
  vi.stubGlobal('fetch', async (input: string | URL) => {
    const url = new URL(input, 'http://localhost');
    if (url.pathname !== '/api/projects') return Response.json([]);
    const gitOnly = url.searchParams.get('gitOnly') === 'true';
    return Response.json(gitOnly ? projects.filter((project) => project.isGitRepo) : projects);
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const totals = { runningCount: 1, needsAttentionCount: 1 };
  try {
    await act(async () =>
      root.render(
        <MemoryRouter>
          <QueryClientProvider client={client}>
            <Sidebar />
          </QueryClientProvider>
        </MemoryRouter>,
      ),
    );
    await vi.waitFor(() => expect(container.textContent).toContain('Local folder'));
    expect(updateTrayStatus).toHaveBeenLastCalledWith(totals);

    const filter = container.querySelector('[aria-label="Filter and sort"]')!;
    await act(async () =>
      filter.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })),
    );
    const gitOnly = [...document.querySelectorAll<HTMLElement>('[role="menuitemcheckbox"]')].find(
      (item) => item.textContent === 'Git repositories only',
    )!;
    await act(async () => gitOnly.click());
    await vi.waitFor(() => {
      expect(container.textContent).toContain('Git workspace');
      expect(container.textContent).not.toContain('Local folder');
    });
    expect(updateTrayStatus).toHaveBeenLastCalledWith(totals);
  } finally {
    act(() => root.unmount());
    client.clear();
    container.remove();
    vi.unstubAllGlobals();
  }
});
