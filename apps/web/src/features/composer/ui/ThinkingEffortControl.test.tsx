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
  onChange.mockClear();
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
it('treats a value named default like every other advertised choice', () => {
  act(() =>
    root.render(<ThinkingEffortControl option={option} onChange={onChange} debounceMs={0} />),
  );
  expect(container.querySelector('[aria-label="Use provider default"]')).toBeNull();
  expect(container.querySelector('[data-testid="thinking-effort-thumb"]')).not.toBeNull();
  expect(container.querySelector('input')?.value).toBe('2');
  expect(container.querySelector('input')?.getAttribute('aria-valuetext')).toBe('Default');
  slide('0');
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
  expect(container.querySelector('input')?.max).toBe('1');
  slide('0');
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
