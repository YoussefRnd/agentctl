import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

vi.mock('@/features/sessions', () => ({
  RewindMenu: () => null,
  useSession: () => ({ sessionId: 'session-1' }),
}));

import { TextCard } from './TextCard';

describe('user message delivery feedback', () => {
  it('does not offer server-only actions on unpersisted optimistic messages', () => {
    const html = renderToStaticMarkup(<TextCard content="hello" variant="user" eventId={-1} />);
    expect(html).not.toContain('Edit prompt');
    expect(html).not.toContain('Sending…');
    expect(html).not.toContain('Accepted · waiting for agent');
  });

  it('keeps the failure reason and retry control visible until retried', () => {
    const container = document.createElement('div');
    const root = createRoot(container);
    const retry = vi.fn();
    try {
      act(() =>
        root.render(
          <TextCard
            content="hello"
            variant="user"
            eventId={-1}
            deliveryStatus="failed"
            deliveryError="Session is unavailable"
            onRetry={retry}
          />,
        ),
      );
      expect(container.textContent).toContain('Message not sent: Session is unavailable');
      const button = [...container.querySelectorAll('button')].find(
        (item) => item.textContent === 'Retry',
      );
      expect(button).toBeDefined();
      act(() => button?.click());
      expect(retry).toHaveBeenCalledWith(-1);
      act(() =>
        root.render(
          <TextCard
            content="hello"
            variant="user"
            eventId={-1}
            deliveryStatus="sending"
            onRetry={retry}
          />,
        ),
      );
      expect(container.textContent).not.toContain('Message not sent');
      expect(container.textContent).not.toContain('Retry');
    } finally {
      act(() => root.unmount());
    }
  });

  it('offers actions once persisted with positive eventId', () => {
    const html = renderToStaticMarkup(
      <TextCard content="hello" variant="user" eventId={42} onRewind={() => {}} />,
    );
    expect(html).toContain('Edit prompt');
  });
});
