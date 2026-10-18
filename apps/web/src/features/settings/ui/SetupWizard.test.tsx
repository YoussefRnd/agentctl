import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vite-plus/test';
import { SetupWizard } from './SetupWizard';

vi.mock('../model/useSetupWizard', () => ({
  useSetupWizard: () => ({ showWizard: true, markDone: vi.fn() }),
}));
vi.mock('../api/useSettings', () => ({
  useSettings: () => ({ settings: {}, updateSettings: vi.fn() }),
}));
afterEach(() => vi.restoreAllMocks());

it('shows a retryable error for a null agent list and recovers when the server returns valid data', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('null'));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(
        <QueryClientProvider client={client}>
          <MemoryRouter>
            <SetupWizard />
          </MemoryRouter>
        </QueryClientProvider>,
      ),
    );
    await vi.waitFor(async () => {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      expect(document.body.textContent).toContain('Could not load agents');
    });
    expect(document.body.textContent).toContain('Invalid agent list');
    expect(document.body.textContent).not.toContain('Something went wrong');
    fetch.mockImplementation(async () => new Response('[]'));
    const retry = [...document.body.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Try again'),
    );
    expect(retry).toBeDefined();
    await act(async () => retry?.click());
    await vi.waitFor(async () => {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      expect(document.body.textContent).not.toContain('Could not load agents');
    });
    expect(document.body.textContent).toContain('Readiness checklist');
    expect(fetch).toHaveBeenCalledTimes(2);
  } finally {
    act(() => root.unmount());
    client.clear();
    container.remove();
  }
});
