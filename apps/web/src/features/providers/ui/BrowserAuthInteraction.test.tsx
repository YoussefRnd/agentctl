import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { expect, test, vi } from 'vitest';
import { BrowserAuthInteraction } from './BrowserAuthInteraction';
const respond = vi.hoisted(() => vi.fn().mockResolvedValue({ success: true }));
vi.mock('@agentctl/api-client', () => ({ providerService: { respondAuthInteraction: respond } }));

test('browser consent requires opening the link and sends the current interaction ID', async () => {
  const container = document.createElement('div');
  const root = createRoot(container);
  const client = new QueryClient();
  try {
    await act(async () =>
      root.render(
        <QueryClientProvider client={client}>
          <BrowserAuthInteraction
            providerId="work"
            request={{ id: 'attempt-1', url: 'https://example.com/login', message: 'Sign in' }}
          />
        </QueryClientProvider>,
      ),
    );
    const button = [...container.querySelectorAll('button')].find(
      (item) => item.textContent === 'Continue sign-in',
    )!;
    expect(button.disabled).toBe(true);
    act(() =>
      container
        .querySelector('a')!
        .dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })),
    );
    expect(button.disabled).toBe(false);
    await act(async () => button.click());
    expect(respond).toHaveBeenCalledWith('work', 'attempt-1', true);
  } finally {
    act(() => root.unmount());
    client.clear();
  }
});
