import { act, useState, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vite-plus/test';
import { SegmentedControl } from './SegmentedControl.js';

let root: Root;
function render(element: ReactNode) {
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() => root.render(element));
  return host;
}
afterEach(() => {
  act(() => root?.unmount());
  document.body.innerHTML = '';
});
const options = [
  { value: 'system', label: 'System', icon: <svg aria-hidden="true" className="h-3.5 w-3.5" /> },
  { value: 'dark', label: 'Dark', disabled: true },
  { value: 'light', label: 'Light' },
] as const;
function Example({ dir }: { dir?: 'rtl' }) {
  const [value, setValue] = useState<string>('system');
  return (
    <SegmentedControl
      aria-label="Theme mode"
      value={value}
      onValueChange={setValue}
      options={dir ? options.map((option) => ({ ...option, disabled: false })) : options}
      style={{ direction: dir }}
    />
  );
}
function key(target: Element, value: string) {
  act(() =>
    target.dispatchEvent(
      new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true }),
    ),
  );
}
it('keeps one selected option and tab stop, skips disabled options and wraps with arrow keys', () => {
  const host = render(<Example />);
  const [system, dark, light] = host.querySelectorAll<HTMLButtonElement>('button');
  expect(system!.tabIndex).toBe(0);
  expect(dark!.disabled).toBe(true);
  expect(light!.tabIndex).toBe(-1);
  act(() => system!.focus());
  key(system!, 'ArrowRight');
  expect(document.activeElement).toBe(light);
  expect(light!.getAttribute('aria-pressed')).toBe('true');
  expect(host.querySelectorAll('[aria-pressed="true"]')).toHaveLength(1);
  expect(light!.tabIndex).toBe(0);
  expect(system!.tabIndex).toBe(-1);
  key(light!, 'ArrowRight');
  expect(document.activeElement).toBe(system);
  key(system!, 'End');
  expect(document.activeElement).toBe(light);
  key(light!, 'Home');
  expect(document.activeElement).toBe(system);
  key(system!, 'ArrowLeft');
  expect(document.activeElement).toBe(light);
});
it('respects right-to-left keyboard direction', () => {
  const host = render(<Example dir="rtl" />);
  const buttons = host.querySelectorAll<HTMLButtonElement>('button');
  act(() => buttons[0]!.focus());
  key(buttons[0]!, 'ArrowRight');
  expect(document.activeElement).toBe(buttons[2]);
});
it('does not submit forms and keeps controlled selection owned by the caller', () => {
  const change = vi.fn();
  const submit = vi.fn((event: React.FormEvent) => event.preventDefault());
  const host = render(
    <form onSubmit={submit}>
      <SegmentedControl
        aria-label="Theme mode"
        value="system"
        options={options}
        onValueChange={change}
      />
    </form>,
  );
  act(() => host.querySelectorAll<HTMLButtonElement>('button')[2]!.click());
  expect(change).toHaveBeenCalledWith('light');
  expect(submit).not.toHaveBeenCalled();
  expect(host.querySelector('[aria-pressed="true"]')?.textContent).toBe('System');
});
it('keeps pointer filtering from stealing input focus and honors consumer keyboard cancellation', () => {
  const change = vi.fn();
  const host = render(
    <>
      <input aria-label="Search" />
      <SegmentedControl
        aria-label="Filter"
        value="system"
        options={options}
        onValueChange={change}
        preserveFocus
        onKeyDown={(event) => event.preventDefault()}
      />
    </>,
  );
  const input = host.querySelector('input')!;
  const button = host.querySelectorAll<HTMLButtonElement>('button')[2]!;
  act(() => input.focus());
  const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
  act(() => {
    button.dispatchEvent(down);
    button.click();
  });
  expect(down.defaultPrevented).toBe(true);
  expect(document.activeElement).toBe(input);
  expect(change).toHaveBeenCalledWith('light');
  change.mockClear();
  act(() => button.focus());
  key(button, 'Home');
  expect(change).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(button);
});
it('supports labels, descriptions, icons and compact typography without imposing a font family', () => {
  const host = render(
    <>
      <label id="mode-label">Mode</label>
      <p id="mode-help">Choose a mode</p>
      <SegmentedControl
        aria-labelledby="mode-label"
        aria-describedby="mode-help"
        value="system"
        options={options}
        onValueChange={() => {}}
        typographyClassName="text-[10px] font-medium"
        itemClassName="h-5 py-0"
      />
    </>,
  );
  const group = host.querySelector('[role="group"]')!;
  const button = group.querySelector('button')!;
  expect(group.getAttribute('aria-labelledby')).toBe('mode-label');
  expect(group.getAttribute('aria-describedby')).toBe('mode-help');
  expect(button.querySelector('svg')?.getAttribute('class')).toBe('h-3.5 w-3.5');
  expect(button.className.split(' ')).toEqual(
    expect.arrayContaining(['text-[10px]', 'font-medium', 'h-5', 'py-0']),
  );
  expect(button.className.split(' ')).not.toEqual(expect.arrayContaining(['text-xs']));
  expect(button.className).not.toMatch(/font-(sans|mono|display)/);
});
it('disables the whole group and provides a reachable option when the value is absent', () => {
  const change = vi.fn();
  const host = render(
    <SegmentedControl aria-label="Mode" value="missing" options={options} onValueChange={change} />,
  );
  expect(host.querySelector('button')!.tabIndex).toBe(0);
  act(() =>
    root.render(
      <SegmentedControl
        aria-label="Mode"
        value="system"
        options={options}
        onValueChange={change}
        disabled
      />,
    ),
  );
  for (const button of host.querySelectorAll('button')) {
    expect(button.disabled).toBe(true);
    expect(button.tabIndex).toBe(-1);
    act(() => button.click());
  }
  expect(change).not.toHaveBeenCalled();
});
