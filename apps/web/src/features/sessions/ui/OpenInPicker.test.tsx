import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vite-plus/test';
import { useOpenWorkspaceFile } from '../model/useOpenWorkspaceFile';
import { OpenInPicker } from './OpenInPicker';

vi.mock('../model/SessionConfigContext', () => ({
  useSession: () => ({ sessionData: { session: { worktreePath: '/worktree' } } }),
}));

function WorkspaceFile() {
  const openFile = useOpenWorkspaceFile();
  return <button onClick={() => void openFile('notes.md')}>Open notes</button>;
}

it('uses the same installed fallback for the workspace picker and its file links', async () => {
  localStorage.setItem('agentctl:preferred-editor', 'cursor');
  const launch = vi.fn();
  vi.stubGlobal('fetch', async (input: string | URL, options?: RequestInit) => {
    const { pathname } = new URL(input, 'http://localhost');
    if (pathname === '/api/editor/available') return Response.json(['vscode']);
    launch(JSON.parse(String(options?.body)));
    return Response.json({ success: true, editor: 'vscode' });
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () =>
      root.render(
        <QueryClientProvider client={client}>
          <OpenInPicker targetPath="/worktree" />
          <WorkspaceFile />
        </QueryClientProvider>,
      ),
    );
    await vi.waitFor(() =>
      expect(host.querySelector('button[aria-label="Open in VS Code"]')).not.toBeNull(),
    );
    const openNotes = [...host.querySelectorAll('button')].find(
      (button) => button.textContent === 'Open notes',
    )!;
    await act(async () => openNotes.click());
    expect(launch).toHaveBeenCalledExactlyOnceWith({
      editor: 'vscode',
      path: '/worktree/notes.md',
    });
  } finally {
    act(() => root.unmount());
    client.clear();
    host.remove();
    localStorage.removeItem('agentctl:preferred-editor');
    vi.unstubAllGlobals();
  }
});
