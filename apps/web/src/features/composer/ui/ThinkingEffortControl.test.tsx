import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import type { AgentConfigOption } from '@agentctl/shared';
import { ThinkingEffortControl } from './ThinkingEffortControl';
vi.mock('@agentctl/ui', async (original) => ({
  ...(await original<typeof import('@agentctl/ui')>()),
  Popover: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  PopoverTrigger: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  PopoverContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
const option: AgentConfigOption = {
  id: 'effort',
  name: 'Effort',
  category: 'thought_level',
  type: 'select',
  currentValue: 'default',
  options: [
    { value: 'low', name: 'Low' },
    { value: 'xhigh', name: 'Extra High' },
    { value: 'default', name: 'Default' },
  ],
};
let root: ReturnType<typeof createRoot>;
let container: HTMLDivElement;
const onChange = vi.fn();
beforeEach(() => {
  vi.useFakeTimers();
  onChange.mockReset();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});
function slide(value: string) {
  const slider = container.querySelector('input')!;
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(slider, value);
    slider.dispatchEvent(new Event('input', { bubbles: true }));
    slider.dispatchEvent(new Event('change', { bubbles: true }));
  });
}
it('uses provider labels and records Home selections immediately', () => {
  act(() =>
    root.render(<ThinkingEffortControl option={option} onChange={onChange} debounceMs={0} />),
  );
  expect(container.querySelector('button')!.getAttribute('aria-label')).toBe(
    'Thinking effort: Default',
  );
  slide('1');
  expect(onChange).toHaveBeenCalledExactlyOnceWith('xhigh');
  expect(container.querySelector('button')!.getAttribute('aria-label')).toBe(
    'Thinking effort: Extra High',
  );
});
it('debounces session updates and sends only the latest slider choice', () => {
  act(() => root.render(<ThinkingEffortControl option={option} onChange={onChange} />));
  slide('0');
  slide('1');
  expect(onChange).not.toHaveBeenCalled();
  act(() => vi.advanceTimersByTime(150));
  expect(onChange).toHaveBeenCalledExactlyOnceWith('xhigh');
});
it('handles one advertised choice without invalid track geometry', () => {
  act(() =>
    root.render(
      <ThinkingEffortControl
        option={{ ...option, options: [option.options![2]] }}
        onChange={onChange}
      />,
    ),
  );
  expect(container.querySelector('input')).toBeNull();
  expect(container.innerHTML).not.toMatch(/NaN|Infinity/);
});
it('keeps the thumb visible and dims the slider when Default is selected', () => {
  act(() =>
    root.render(<ThinkingEffortControl option={option} onChange={onChange} debounceMs={0} />),
  );
  expect(
    container.querySelector('[aria-label="Use provider default"]')?.getAttribute('aria-pressed'),
  ).toBe('true');
  expect(container.querySelector('[data-testid="thinking-effort-thumb"]')).not.toBeNull();
  expect(
    container
      .querySelector('[data-testid="thinking-effort-slider"]')
      ?.classList.contains('opacity-40'),
  ).toBe(true);
  expect(container.querySelector('input')?.max).toBe('1');
  expect(container.querySelector('input')?.value).toBe('0');
  expect(container.querySelector('input')?.getAttribute('aria-valuetext')).toBe('Default');
  expect(onChange).not.toHaveBeenCalled();
  act(() => container.querySelector('input')!.click());
  expect(onChange).toHaveBeenCalledExactlyOnceWith('low');
});

it('preserves the provider ordering even for familiar effort IDs', () => {
  const reversed = {
    ...option,
    currentValue: 'high',
    options: [
      { value: 'high', name: 'High' },
      { value: 'medium', name: 'Medium' },
      { value: 'low', name: 'Low' },
    ],
  };
  act(() =>
    root.render(<ThinkingEffortControl option={reversed} onChange={onChange} debounceMs={0} />),
  );
  expect(container.querySelector('input')?.value).toBe('0');
  slide('2');
  expect(onChange).toHaveBeenCalledExactlyOnceWith('low');
});

it('allows a single explicit level alongside provider default', () => {
  act(() =>
    root.render(
      <ThinkingEffortControl
        option={{ ...option, options: [option.options![0], option.options![2]] }}
        onChange={onChange}
        debounceMs={0}
      />,
    ),
  );
  expect(container.querySelector('input')).toBeNull();
  const low = [...container.querySelectorAll('button')].find(
    (button) => button.textContent === 'Low',
  )!;
  act(() => low.click());
  expect(onChange).toHaveBeenCalledExactlyOnceWith('low');
});
it('restores the advertised value after a rejected update', async () => {
  const rejectChange = vi.fn().mockRejectedValue(new Error('unsupported for this model'));
  act(() =>
    root.render(<ThinkingEffortControl option={option} onChange={rejectChange} debounceMs={0} />),
  );
  slide('1');
  await act(async () => {
    await Promise.resolve();
  });
  expect(rejectChange).toHaveBeenCalledExactlyOnceWith('xhigh');
  expect(container.querySelector('button')?.getAttribute('aria-label')).toBe(
    'Thinking effort: Default',
  );
});

it('preserves opaque values and their provider labels', () => {
  act(() =>
    root.render(
      <ThinkingEffortControl
        option={{
          ...option,
          currentValue: 'vendor-z',
          options: [
            { value: 'vendor-z', name: 'Budget Z' },
            { value: 'vendor-a', name: 'Budget A' },
          ],
        }}
        onChange={onChange}
        debounceMs={0}
      />,
    ),
  );
  slide('1');
  expect(onChange).toHaveBeenCalledExactlyOnceWith('vendor-a');
  expect(container.querySelector('input')?.getAttribute('aria-valuetext')).toBe('Budget A');
});

it('returns to Default without moving the slider to a level', () => {
  act(() =>
    root.render(<ThinkingEffortControl option={option} onChange={onChange} debounceMs={0} />),
  );
  slide('1');
  expect(container.querySelector('[data-testid="thinking-effort-thumb"]')).not.toBeNull();
  onChange.mockClear();
  act(() =>
    container.querySelector<HTMLButtonElement>('[aria-label="Use provider default"]')!.click(),
  );
  expect(onChange).toHaveBeenCalledExactlyOnceWith('default');
  expect(container.querySelector('input')?.value).toBe('1');
  expect(container.querySelector('[data-testid="thinking-effort-thumb"]')).not.toBeNull();
  expect(
    container
      .querySelector('[data-testid="thinking-effort-slider"]')
      ?.classList.contains('opacity-40'),
  ).toBe(true);
  expect(container.querySelector('input')?.getAttribute('aria-valuetext')).toBe('Default');
});

it('clears the prior slider selection when a new model reports Default', () => {
  act(() =>
    root.render(
      <ThinkingEffortControl
        key="first-model"
        option={{ ...option, currentValue: 'xhigh' }}
        onChange={onChange}
      />,
    ),
  );
  expect(container.querySelector('[data-testid="thinking-effort-thumb"]')).not.toBeNull();
  act(() =>
    root.render(<ThinkingEffortControl key="second-model" option={option} onChange={onChange} />),
  );
  expect(container.querySelector('[data-testid="thinking-effort-thumb"]')).not.toBeNull();
  expect(
    container
      .querySelector('[data-testid="thinking-effort-slider"]')
      ?.classList.contains('opacity-40'),
  ).toBe(true);
  expect(
    container.querySelector('[aria-label="Use provider default"]')?.getAttribute('aria-pressed'),
  ).toBe('true');
  expect(onChange).not.toHaveBeenCalled();
});

it('does not send a pending slider change after returning to Default', () => {
  act(() => root.render(<ThinkingEffortControl option={option} onChange={onChange} />));
  slide('1');
  act(() =>
    container.querySelector<HTMLButtonElement>('[aria-label="Use provider default"]')!.click(),
  );
  act(() => vi.advanceTimersByTime(150));
  expect(onChange).toHaveBeenCalledExactlyOnceWith('default');
  expect(container.querySelector('input')?.value).toBe('1');
  expect(container.querySelector('[data-testid="thinking-effort-thumb"]')).not.toBeNull();
  expect(
    container
      .querySelector('[data-testid="thinking-effort-slider"]')
      ?.classList.contains('opacity-40'),
  ).toBe(true);
});

it('ignores an older failure and acknowledgement after a newer slider selection', async () => {
  const older = Promise.withResolvers<void>();
  const latest = Promise.withResolvers<void>();
  onChange.mockReturnValueOnce(older.promise).mockReturnValueOnce(latest.promise);
  act(() =>
    root.render(<ThinkingEffortControl option={option} onChange={onChange} debounceMs={0} />),
  );
  act(() => container.querySelector('input')!.click());
  slide('1');
  await act(async () => older.reject(new Error('old request failed')));
  expect(container.querySelector('button')?.getAttribute('aria-label')).toBe(
    'Thinking effort: Extra High',
  );
  act(() =>
    root.render(
      <ThinkingEffortControl
        option={{ ...option, currentValue: 'low' }}
        onChange={onChange}
        debounceMs={0}
      />,
    ),
  );
  expect(container.querySelector('input')?.value).toBe('1');
  expect(onChange).toHaveBeenCalledTimes(2);
  await act(async () => latest.resolve());
  act(() =>
    root.render(
      <ThinkingEffortControl
        option={{ ...option, currentValue: 'xhigh' }}
        onChange={onChange}
        debounceMs={0}
      />,
    ),
  );
  expect(container.querySelector('button')?.getAttribute('aria-label')).toBe(
    'Thinking effort: Extra High',
  );
});

it('protects a newer choice while it is still waiting for debounce', async () => {
  const older = Promise.withResolvers<void>();
  onChange.mockReturnValueOnce(older.promise).mockResolvedValue(undefined);
  act(() => root.render(<ThinkingEffortControl option={option} onChange={onChange} />));
  act(() => container.querySelector('input')!.click());
  act(() => vi.advanceTimersByTime(150));
  slide('1');
  await act(async () => older.reject(new Error('old failure')));
  act(() => vi.advanceTimersByTime(150));
  expect(onChange.mock.calls.map(([value]) => value)).toEqual(['low', 'xhigh']);
  expect(container.querySelector('button')?.getAttribute('aria-label')).toBe(
    'Thinking effort: Extra High',
  );
});

it('keeps a newer Default choice dimmed when an older request fails', async () => {
  const older = Promise.withResolvers<void>();
  const latest = Promise.withResolvers<void>();
  onChange.mockReturnValueOnce(older.promise).mockReturnValueOnce(latest.promise);
  act(() =>
    root.render(<ThinkingEffortControl option={option} onChange={onChange} debounceMs={0} />),
  );
  slide('1');
  act(() =>
    container.querySelector<HTMLButtonElement>('[aria-label="Use provider default"]')!.click(),
  );
  await act(async () => older.reject(new Error('old failure')));
  expect(
    container.querySelector('[aria-label="Use provider default"]')?.getAttribute('aria-pressed'),
  ).toBe('true');
  expect(
    container
      .querySelector('[data-testid="thinking-effort-slider"]')
      ?.classList.contains('opacity-40'),
  ).toBe(true);
  expect(container.querySelector('input')?.value).toBe('1');
  await act(async () => latest.resolve());
});

it('keeps the Default thumb in place when an older selection is acknowledged', () => {
  onChange.mockReturnValue(new Promise<void>(() => {}));
  act(() =>
    root.render(<ThinkingEffortControl option={option} onChange={onChange} debounceMs={0} />),
  );
  act(() => container.querySelector('input')!.click());
  slide('1');
  act(() =>
    container.querySelector<HTMLButtonElement>('[aria-label="Use provider default"]')!.click(),
  );
  expect(container.querySelector('input')?.value).toBe('1');
  act(() =>
    root.render(
      <ThinkingEffortControl
        option={{ ...option, currentValue: 'low' }}
        onChange={onChange}
        debounceMs={0}
      />,
    ),
  );
  expect(container.querySelector('input')?.value).toBe('1');
  expect(
    container.querySelector('[aria-label="Use provider default"]')?.getAttribute('aria-pressed'),
  ).toBe('true');
});

it('sends the latest choice even when an older acknowledgement has the same value', () => {
  onChange.mockReturnValue(new Promise<void>(() => {}));
  act(() => root.render(<ThinkingEffortControl option={option} onChange={onChange} />));
  act(() => container.querySelector('input')!.click());
  act(() => vi.advanceTimersByTime(150));
  slide('1');
  act(() => vi.advanceTimersByTime(150));
  slide('0');
  act(() =>
    root.render(
      <ThinkingEffortControl option={{ ...option, currentValue: 'low' }} onChange={onChange} />,
    ),
  );
  act(() => vi.advanceTimersByTime(150));
  expect(onChange.mock.calls.map(([value]) => value)).toEqual(['low', 'xhigh', 'low']);
});

it('uses the canonical value when the latest asynchronous update finishes', async () => {
  const latest = Promise.withResolvers<void>();
  onChange.mockReturnValue(latest.promise);
  act(() =>
    root.render(<ThinkingEffortControl option={option} onChange={onChange} debounceMs={0} />),
  );
  slide('1');
  act(() =>
    root.render(
      <ThinkingEffortControl
        option={{ ...option, currentValue: 'low' }}
        onChange={onChange}
        debounceMs={0}
      />,
    ),
  );
  expect(container.querySelector('input')?.value).toBe('1');
  await act(async () => latest.resolve());
  expect(container.querySelector('input')?.value).toBe('0');
  expect(container.querySelector('button')?.getAttribute('aria-label')).toBe(
    'Thinking effort: Low',
  );
  act(() =>
    root.render(<ThinkingEffortControl option={option} onChange={onChange} debounceMs={0} />),
  );
  expect(container.querySelector('input')?.value).toBe('0');
});

it('preserves the last confirmed thumb position when Default is reported externally', () => {
  act(() =>
    root.render(
      <ThinkingEffortControl option={{ ...option, currentValue: 'xhigh' }} onChange={onChange} />,
    ),
  );
  expect(container.querySelector('input')?.value).toBe('1');
  act(() => root.render(<ThinkingEffortControl option={option} onChange={onChange} />));
  expect(container.querySelector('input')?.value).toBe('1');
  expect(container.querySelector('input')?.getAttribute('aria-valuetext')).toBe('Default');
});
