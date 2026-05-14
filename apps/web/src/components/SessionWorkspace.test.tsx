import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

import { SessionWorkspace } from './SessionWorkspace.js';

const mockUseSessionEvents = vi.fn();

vi.mock('../hooks/useSessionEvents.js', () => ({
  useSessionEvents: (...args: unknown[]) => mockUseSessionEvents(...args),
}));

const mockFetch = vi.fn();
const mockSessionFetch = vi.fn();

vi.mock('../lib/api-client.js', () => ({
  apiClient: {
    fetch: (...args: unknown[]) => mockFetch(...args),
  },
}));

afterEach(() => {
  cleanup();
  mockFetch.mockReset();
  mockSessionFetch.mockReset();
  mockUseSessionEvents.mockReset();
});

function setDefaultSessionEvents() {
  mockUseSessionEvents.mockReturnValue({
    events: [],
    isLoading: false,
    error: null,
    refetch: vi.fn(),
    sendMessage: vi.fn(),
    isConnected: true,
  });
}

function renderWorkspace() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <SessionWorkspace sessionId="session-1" />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

function mockSessionResponse() {
  mockFetch.mockImplementation((url: string) => {
    if (url.includes('/sessions/') && !url.includes('/review') && !url.includes('/events') && !url.includes('/provider')) {
      return Promise.resolve({
        session: {
          id: 'session-1',
          projectId: '550e8400-e29b-41d4-a716-446655440000',
          branch: 'main',
          worktreePath: '/tmp/worktree',
          taskSlug: 'task',
          baseCommit: 'abc',
          agent: 'claude-code',
          agentSessionId: null,
          status: 'idle',
          totalTokens: 0,
          contextLimit: 128000,
          estimatedCost: 0,
          lastHeartbeat: null,
          closedAt: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          selectedDriver: 'claude-code',
          selectedModel: 'sonnet-4',
          selectedThinkingEffort: 'medium',
        },
        capabilities: [],
      });
    }

    if (url.includes('/events')) {
      return Promise.resolve([]);
    }

    return Promise.resolve({ files: [] });
  });
}

describe('SessionWorkspace', () => {
  it('switches between feed and review without unmounting the feed', async () => {
    setDefaultSessionEvents();
    mockSessionResponse();
    mockFetch.mockImplementation((url: string) => {
      if (url.includes('/review')) {
        return Promise.resolve({ files: [{ path: 'src/app.ts', state: 'modified', diff: '+hello' }] });
      }

      if (url.includes('/events')) {
        return Promise.resolve([]);
      }

      return Promise.resolve({
        session: {
          id: 'session-1',
          projectId: '550e8400-e29b-41d4-a716-446655440000',
          branch: 'main',
          worktreePath: '/tmp/worktree',
          taskSlug: 'task',
          baseCommit: 'abc',
          agent: 'claude-code',
          agentSessionId: null,
          status: 'idle',
          totalTokens: 0,
          contextLimit: 128000,
          estimatedCost: 0,
          lastHeartbeat: null,
          closedAt: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          selectedDriver: 'claude-code',
          selectedModel: 'sonnet-4',
          selectedThinkingEffort: 'medium',
        },
        capabilities: [],
      });
    });
    renderWorkspace();

    expect(screen.getByText('Agent Connecting...')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'Review' }));

    expect(screen.getByText('Loading review diff...')).toBeInTheDocument();

    await waitFor(() => expect(screen.getByText('src/app.ts')).toBeInTheDocument());
    expect(screen.getByRole('tab', { name: 'Feed' })).toBeInTheDocument();
    expect(screen.getByText('Agent Connecting...')).toBeInTheDocument();
  });

  it('shows an inline error when the review diff fails to load', async () => {
    setDefaultSessionEvents();
    mockSessionResponse();
    mockFetch.mockImplementation((url: string) => {
      if (url.includes('/events')) {
        return Promise.resolve([]);
      }

      if (url.includes('/review')) {
        return Promise.reject(new Error('review failed'));
      }

      return Promise.resolve({ files: [] });
    });

    renderWorkspace();

    fireEvent.click(screen.getByRole('tab', { name: 'Review' }));

    expect(await screen.findByText('Failed to load review diff')).toBeInTheDocument();
    expect(screen.getByText('review failed')).toBeInTheDocument();
  });

  it('shows an inline error when the session history fails to load', async () => {
    mockSessionResponse();
    mockUseSessionEvents.mockReturnValue({
      events: [],
      isLoading: false,
      error: new Error('history failed'),
      refetch: vi.fn(),
      sendMessage: vi.fn(),
      isConnected: true,
    });
    mockFetch.mockResolvedValueOnce({ files: [] });

    renderWorkspace();

    expect(await screen.findByText('Failed to load session history')).toBeInTheDocument();
    expect(screen.getByText('history failed')).toBeInTheDocument();
  });

  it('shows a review badge dot when dirty worktree changes exist', async () => {
    setDefaultSessionEvents();
    mockSessionResponse();
    mockFetch.mockImplementation((url: string) => {
      if (url.includes('/review')) {
        return Promise.resolve({
          files: [
            { path: 'src/new.ts', state: 'untracked', diff: '+new file' },
            { path: 'src/old.ts', state: 'committed', diff: '' },
          ],
        });
      }

      return Promise.resolve({
        session: {
          id: 'session-1',
          projectId: '550e8400-e29b-41d4-a716-446655440000',
          branch: 'main',
          worktreePath: '/tmp/worktree',
          taskSlug: 'task',
          baseCommit: 'abc',
          agent: 'claude-code',
          agentSessionId: null,
          status: 'idle',
          totalTokens: 0,
          contextLimit: 128000,
          estimatedCost: 0,
          lastHeartbeat: null,
          closedAt: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          selectedDriver: 'claude-code',
          selectedModel: 'sonnet-4',
          selectedThinkingEffort: 'medium',
        },
        capabilities: [],
      });
    });

    renderWorkspace();

    await waitFor(() => expect(screen.getByText('src/new.ts')).toBeInTheDocument());
    expect(screen.getByText('src/old.ts')).toBeInTheDocument();
    expect(screen.getAllByTestId('review-badge-dot')).not.toHaveLength(0);
  });
});
