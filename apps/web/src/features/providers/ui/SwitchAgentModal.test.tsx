// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SwitchAgentModal } from './SwitchAgentModal';

afterEach(() => {
  document.body.innerHTML = '';
});

function renderWithClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
  });

  return { root, container };
}

describe('SwitchAgentModal', () => {
  it('renders both segmented options with Handoff selected by default and calls onConfirmHandoff', () => {
    const handleConfirmHandoff = vi.fn();
    const handleConfirmNewSession = vi.fn();

    const { root } = renderWithClient(
      <SwitchAgentModal
        open={true}
        onOpenChange={() => undefined}
        currentProvider="claude"
        targetProvider="openai"
        targetModel="gpt-5"
        onConfirmHandoff={handleConfirmHandoff}
        onConfirmNewSession={handleConfirmNewSession}
      />,
    );

    // Verify title and segmented control
    expect(document.body.textContent).toMatch(/Switch to Openai/i);
    expect(document.body.textContent).toContain('Handoff');
    expect(document.body.textContent).toContain('New Session');

    // Confirm button in handoff mode
    const confirmButton = [...document.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Handoff & Continue'),
    );
    expect(confirmButton).toBeDefined();

    act(() => {
      confirmButton?.click();
    });

    expect(handleConfirmHandoff).toHaveBeenCalledTimes(1);
    expect(handleConfirmNewSession).not.toHaveBeenCalled();

    act(() => {
      root.unmount();
    });
  });

  it('allows switching to New Session and calls onConfirmNewSession', () => {
    const handleConfirmHandoff = vi.fn();
    const handleConfirmNewSession = vi.fn();

    const { root } = renderWithClient(
      <SwitchAgentModal
        open={true}
        onOpenChange={() => undefined}
        currentProvider="claude"
        targetProvider="openai"
        targetModel="gpt-5"
        onConfirmHandoff={handleConfirmHandoff}
        onConfirmNewSession={handleConfirmNewSession}
      />,
    );

    // Click "New Session" segmented button
    const newSessionTab = [...document.querySelectorAll('button')].find(
      (b) => b.textContent?.trim() === 'New Session',
    );
    expect(newSessionTab).toBeDefined();

    act(() => {
      newSessionTab?.click();
    });

    // Confirm button should now say "Start Fresh Session"
    const confirmButton = [...document.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Start Fresh Session'),
    );
    expect(confirmButton).toBeDefined();

    act(() => {
      confirmButton?.click();
    });

    expect(handleConfirmNewSession).toHaveBeenCalledTimes(1);
    expect(handleConfirmHandoff).not.toHaveBeenCalled();

    act(() => {
      root.unmount();
    });
  });
});
