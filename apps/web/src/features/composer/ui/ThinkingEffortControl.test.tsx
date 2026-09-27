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
  expect(container.querySelector('button')!.textContent).toBe('Default');
  slide('1');
  expect(onChange).toHaveBeenCalledExactlyOnceWith('xhigh');
  expect(container.querySelector('button')!.textContent).toBe('Extra High');
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
  expect(container.querySelector('input')!.disabled).toBe(true);
  expect(container.innerHTML).not.toMatch(/NaN|Infinity/);
});
