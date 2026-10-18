import { describe, expect, it, vi, afterEach } from 'vite-plus/test';
import { renderToStaticMarkup } from 'react-dom/server';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

vi.mock('@/features/sessions', () => ({
  RewindMenu: () => null,
  useSession: () => ({ sessionId: 'session-1' }),
}));

import { TextCard } from './TextCard';

afterEach(() => vi.restoreAllMocks());

describe('user message delivery feedback', () => {
  it.each([
    undefined,
    'Authentication required Agent stderr: [session/create] phase=register durationMs=1620',
  ])(
    'keeps uncertain delivery compact without printing stored diagnostics (%s)',
    (deliveryError) => {
      const html = renderToStaticMarkup(
        <TextCard
          content="hey"
          variant="user"
          eventId={42}
          deliveryStatus="unknown"
          deliveryError={deliveryError}
          onRetry={() => {}}
        />,
      );
      expect(html).toContain('Delivery uncertain');
      expect(html).not.toContain('Authentication required');
      expect(html).not.toContain('Agent stderr');
      expect(html).not.toContain('session/create');
      expect(html).not.toContain('Check the provider before resending');
      expect(html).not.toContain('Retry');
    },
  );

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
      expect(container.textContent).toContain(
        'Message not sent: The agent could not complete this turn.',
      );
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
      <TextCard content="hello" variant="user" eventId={42} onEditSubmit={() => {}} />,
    );
    expect(html).toContain('Edit prompt');
  });

  it('uses the full-width editor and preserves context when saving a changed prompt', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    const submit = vi.fn().mockResolvedValue(false);
    const context = '### Context Attachment: `src/file.ts`\n```ts\nexport {};\n```';
    try {
      act(() =>
        root.render(
          <TextCard
            content={`Original\n\n${context}`}
            variant="user"
            eventId={42}
            onEditSubmit={submit}
          />,
        ),
      );
      act(() => container.querySelector<HTMLButtonElement>('[aria-label="Edit prompt"]')!.click());
      const textarea = container.querySelector('textarea')!;
      expect(document.activeElement).toBe(textarea);
      expect(textarea.value).toBe('Original');
      expect(textarea.closest('.group\\/bubble')?.parentElement?.className).toContain('max-w-full');
      expect(container.querySelector('[aria-label="Cancel editing"]')?.textContent).toBe('Cancel');
      expect(container.textContent).not.toContain('Esc to cancel');
      act(() => {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(
          textarea,
          'Updated',
        );
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await act(async () =>
        [...container.querySelectorAll<HTMLButtonElement>('button')]
          .find((button) => button.textContent === 'Send')!
          .click(),
      );
      expect(submit).toHaveBeenCalledWith(42, `Updated\n\n${context}`);
      expect(container.querySelector('textarea')!.value).toBe('Updated');
      expect(container.querySelector('[role="alert"]')).not.toBeNull();
      submit.mockResolvedValue(true);
      await act(async () =>
        [...container.querySelectorAll<HTMLButtonElement>('button')]
          .find((button) => button.textContent === 'Send')!
          .click(),
      );
      expect(container.querySelector('textarea')).toBeNull();
      expect(document.activeElement).toBe(container.querySelector('[aria-label="Edit prompt"]'));
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });

  it.each([false, true])(
    'resizes edit/cancel without scaling text (reduced motion: %s)',
    (reduced) => {
      const cancel = vi.fn();
      const animate = vi.fn(() => ({ cancel }) as unknown as Animation);
      vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: reduced } as MediaQueryList);
      Object.defineProperty(HTMLElement.prototype, 'animate', {
        configurable: true,
        value: animate,
      });
      const rect = vi
        .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
        .mockImplementation(function (this: HTMLElement) {
          return {
            width: this.querySelector('textarea') ? 600 : 160,
            height: this.querySelector('textarea') ? 140 : 72,
          } as DOMRect;
        });
      const container = document.createElement('div');
      document.body.append(container);
      const root = createRoot(container);
      try {
        act(() =>
          root.render(
            <TextCard content="Original" variant="user" eventId={42} onEditSubmit={() => true} />,
          ),
        );
        expect(animate).not.toHaveBeenCalled();
        act(() =>
          container.querySelector<HTMLButtonElement>('[aria-label="Edit prompt"]')!.click(),
        );
        if (!reduced) {
          expect(animate).toHaveBeenCalledWith(
            [
              { width: '160px', height: '72px', maxWidth: '100%', overflow: 'clip' },
              { width: '600px', height: '140px', maxWidth: '100%', overflow: 'clip' },
            ],
            expect.objectContaining({ duration: 200 }),
          );
        }
        act(() =>
          container.querySelector<HTMLButtonElement>('[aria-label="Cancel editing"]')!.click(),
        );
        expect(document.activeElement).toBe(container.querySelector('[aria-label="Edit prompt"]'));
        if (reduced) expect(animate).not.toHaveBeenCalled();
        else {
          expect(cancel).toHaveBeenCalledOnce();
          expect(animate).toHaveBeenCalledTimes(3);
        }
      } finally {
        act(() => root.unmount());
        container.remove();
        rect.mockRestore();
        delete (HTMLElement.prototype as Partial<HTMLElement>).animate;
      }
    },
  );
});
