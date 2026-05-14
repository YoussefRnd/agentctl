import { describe, it, expect, vi, beforeEach } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NewProjectPalette } from './NewProjectPalette.js';

const mockNavigate = vi.hoisted(() => vi.fn());
vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}));

const mockPickDirectory = vi.hoisted(() => vi.fn());
vi.mock('../hooks/useDirectoryPicker.js', () => ({
  useDirectoryPicker: () => ({ pickDirectory: mockPickDirectory }),
}));

const mockFetch = vi.hoisted(() => vi.fn());
vi.mock('../lib/api-client.js', () => ({
  apiClient: { fetch: mockFetch },
}));

function renderWithProviders(ui: React.ReactElement) {
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      {ui}
    </QueryClientProvider>
  );
}

describe('NewProjectPalette', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('renders the welcome heading and New project button', () => {
    renderWithProviders(<NewProjectPalette />);
    expect(screen.getByText('Welcome to Agent Workbench')).toBeDefined();
    expect(screen.getByText('New project')).toBeDefined();
  });

  it('shows path input after clicking New project', async () => {
    renderWithProviders(<NewProjectPalette />);
    fireEvent.click(screen.getByText('New project'));

    await waitFor(() => {
      expect(screen.getByPlaceholderText('/home/user/myproject')).toBeDefined();
    });

    const input = screen.getByPlaceholderText('/home/user/myproject');
    fireEvent.change(input, { target: { value: '/home/user/myproject' } });

    await waitFor(() => {
      expect(screen.getByText('myproject')).toBeDefined();
    });
  });

  it('submits provider selection with the path and navigates to session', async () => {
    mockFetch.mockResolvedValue({
      project: { id: 'proj-1', name: 'myproject', path: '/home/user/myproject' },
      sessionId: 'session-1',
    });

    renderWithProviders(<NewProjectPalette />);

    fireEvent.click(screen.getByText('New project'));

    const input = screen.getByPlaceholderText('/home/user/myproject');
    fireEvent.change(input, { target: { value: '/home/user/myproject' } });
    fireEvent.click(screen.getByText('Next'));

    await waitFor(() => {
      expect(screen.getByText('Choose a provider')).toBeDefined();
    });

    fireEvent.click(screen.getByText('Claude Code'));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith('/api/projects', {
        method: 'POST',
        body: JSON.stringify({
          path: '/home/user/myproject',
          selectedDriver: 'claude-code',
        }),
      });
      expect(mockNavigate).toHaveBeenCalledWith('/sessions/session-1');
    });
  });
});
