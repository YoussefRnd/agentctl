// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { useDoubleEscToStop, ESC_STOP_TOAST_ID } from './useDoubleEscToStop';
import { toast } from 'sonner';

vi.mock('sonner', () => ({
  toast: {
    info: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
  },
}));

const mockedToastInfo = vi.mocked(toast.info);

function TestComponent({
  isRunning,
  onStop,
  thresholdMs,
}: {
  isRunning: boolean;
  onStop: () => void;
  thresholdMs?: number;
}) {
  useDoubleEscToStop({ isRunning, onStop, thresholdMs });
  return <div data-testid="test-harness">Harness</div>;
}

describe('useDoubleEscToStop', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    document.body.innerHTML = '';
    vi.useRealTimers();
  });

  it('triggers onStop and updates toast when Esc is clicked twice within threshold', () => {
    const onStop = vi.fn();

    act(() => {
      root.render(<TestComponent isRunning={true} onStop={onStop} thresholdMs={1000} />);
    });

    // First Esc press
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });

    expect(onStop).not.toHaveBeenCalled();
    expect(mockedToastInfo).toHaveBeenCalledWith('Press Esc again to stop the agent', {
      id: ESC_STOP_TOAST_ID,
      duration: 1500,
    });

    // Advance 300ms (within 1000ms threshold)
    act(() => {
      vi.advanceTimersByTime(300);
    });

    // Second Esc press
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });

    expect(onStop).toHaveBeenCalledTimes(1);
    expect(mockedToastInfo).toHaveBeenCalledWith('Agent stopped', {
      id: ESC_STOP_TOAST_ID,
    });
  });

  it('does not trigger onStop when second Esc is pressed after threshold', () => {
    const onStop = vi.fn();

    act(() => {
      root.render(<TestComponent isRunning={true} onStop={onStop} thresholdMs={1000} />);
    });

    // First Esc press
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(onStop).not.toHaveBeenCalled();

    // Advance 1200ms (> 1000ms threshold)
    act(() => {
      vi.advanceTimersByTime(1200);
    });

    // Second Esc press (treated as a new first Esc)
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });

    expect(onStop).not.toHaveBeenCalled();
    expect(mockedToastInfo).toHaveBeenLastCalledWith('Press Esc again to stop the agent', {
      id: ESC_STOP_TOAST_ID,
      duration: 1500,
    });
  });

  it('does nothing when isRunning is false', () => {
    const onStop = vi.fn();

    act(() => {
      root.render(<TestComponent isRunning={false} onStop={onStop} thresholdMs={1000} />);
    });

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      vi.advanceTimersByTime(200);
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });

    expect(onStop).not.toHaveBeenCalled();
    expect(mockedToastInfo).not.toHaveBeenCalled();
  });

  it('does not trigger stop if a modal dialog is open', () => {
    const onStop = vi.fn();

    // Create a dialog in the DOM
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    document.body.appendChild(dialog);

    act(() => {
      root.render(<TestComponent isRunning={true} onStop={onStop} thresholdMs={1000} />);
    });

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      vi.advanceTimersByTime(200);
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });

    expect(onStop).not.toHaveBeenCalled();
    expect(mockedToastInfo).not.toHaveBeenCalled();
  });

  it('resets sequence if user presses another key between Escapes', () => {
    const onStop = vi.fn();

    act(() => {
      root.render(<TestComponent isRunning={true} onStop={onStop} thresholdMs={1000} />);
    });

    // First Esc press
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(mockedToastInfo).toHaveBeenCalledTimes(1);

    // Another key press
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
    });

    // Second Esc press
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });

    expect(onStop).not.toHaveBeenCalled();
    // It should have registered as a new first press
    expect(mockedToastInfo).toHaveBeenCalledTimes(2);
  });

  it('resets sequence on window blur', () => {
    const onStop = vi.fn();

    act(() => {
      root.render(<TestComponent isRunning={true} onStop={onStop} thresholdMs={1000} />);
    });

    // First Esc press
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });

    // Window blur
    act(() => {
      window.dispatchEvent(new Event('blur'));
    });

    // Second Esc press
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });

    expect(onStop).not.toHaveBeenCalled();
  });

  it('cleans up event listeners when unmounted', () => {
    const onStop = vi.fn();

    act(() => {
      root.render(<TestComponent isRunning={true} onStop={onStop} thresholdMs={1000} />);
    });

    act(() => {
      root.unmount();
    });

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });

    expect(onStop).not.toHaveBeenCalled();
  });
});
