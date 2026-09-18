// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { AppErrorBoundary } from './AppErrorBoundary';

function ProblemChild({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) {
    throw new Error('Test rendering explosion');
  }
  return <div>Healthy Workspace</div>;
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('AppErrorBoundary', () => {
  it('renders children normally when no error occurs', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    act(() => {
      root.render(
        <AppErrorBoundary onRetry={vi.fn()}>
          <ProblemChild shouldThrow={false} />
        </AppErrorBoundary>,
      );
    });

    expect(container.textContent).toContain('Healthy Workspace');
  });

  it('renders modern error card with message when child throws', () => {
    // Suppress console.error during expected throw
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    const onRetry = vi.fn();

    act(() => {
      root.render(
        <AppErrorBoundary onRetry={onRetry}>
          <ProblemChild shouldThrow={true} />
        </AppErrorBoundary>,
      );
    });

    expect(container.textContent).toContain('Something went wrong');
    expect(container.textContent).toContain('Test rendering explosion');
    expect(container.textContent).toContain('Reload Workspace');

    const reloadButton = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Reload Workspace'),
    );
    expect(reloadButton).toBeDefined();

    act(() => {
      reloadButton?.click();
    });

    expect(onRetry).toHaveBeenCalledTimes(1);

    consoleSpy.mockRestore();
  });
});
