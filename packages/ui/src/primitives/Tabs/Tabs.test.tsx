import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createPortal } from 'react-dom';
import { afterEach, expect, it, vi } from 'vite-plus/test';
import { Tabs, TabsRoot, TabsList, TabsTrigger, TabsContent } from './Tabs.js';
let root: Root;
afterEach(() => {
  act(() => root?.unmount());
  document.body.innerHTML = '';
});
it('navigates styled tabs from their rendered controls', () => {
  function StyledTabs() {
    const [value, setValue] = useState('one');
    return (
      <Tabs value={value} onValueChange={setValue}>
        <TabsList>
          <TabsTrigger value="one">One</TabsTrigger>
          <TabsTrigger value="disabled" disabled>
            Disabled
          </TabsTrigger>
          <TabsTrigger value="two">Two</TabsTrigger>
        </TabsList>
        <TabsContent value="one">First</TabsContent>
        <TabsContent value="two">Second</TabsContent>
      </Tabs>
    );
  }
  const host = render(<StyledTabs />);
  const selected = host.querySelector('[role="tab"][aria-selected="true"]')!;
  expect(selected.textContent).toBe('One');
  expect(host.querySelector('[role="tabpanel"]')?.textContent).toBe('First');
  act(() => (selected as HTMLElement).focus());
  press(selected, 'ArrowRight');
  expect(document.activeElement?.textContent).toBe('Two');
  expect(host.querySelector('[role="tabpanel"]')?.textContent).toBe('Second');
});

function render(element: React.ReactNode) {
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() => root.render(element));
  return host;
}
function press(element: Element, key: string, extra: KeyboardEventInit = {}) {
  act(() =>
    element.dispatchEvent(
      new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...extra }),
    ),
  );
}
function Example({
  direction = 'ltr',
  orientation = 'horizontal',
}: {
  direction?: 'ltr' | 'rtl';
  orientation?: 'horizontal' | 'vertical' | 'auto';
}) {
  const [value, setValue] = useState('one');
  return (
    <TabsRoot
      value={value}
      onValueChange={setValue}
      items={['one', { value: 'disabled', disabled: true }, 'two', 'three']}
      orientation={orientation}
    >
      <TabsList unstyled aria-label="Views" style={{ direction }}>
        <TabsTrigger unstyled value="one">
          One
        </TabsTrigger>
        <TabsTrigger unstyled value="disabled">
          Disabled
        </TabsTrigger>
        <TabsTrigger unstyled value="two">
          Two
        </TabsTrigger>
        <TabsTrigger unstyled value="three">
          Three
        </TabsTrigger>
      </TabsList>
      <TabsContent unstyled value={value}>
        Panel {value}
      </TabsContent>
    </TabsRoot>
  );
}
it('shares unstyled roving focus, disabled skipping, wraparound and panel associations', () => {
  const host = render(<Example />);
  const tabs = host.querySelectorAll<HTMLButtonElement>('[role="tab"]');
  expect(host.children).toHaveLength(2);
  expect(host.querySelector('[role="tablist"]')!.className).toBe('');
  expect(tabs[1]!.disabled).toBe(true);
  expect(tabs[0]!.tabIndex).toBe(0);
  expect(tabs[2]!.tabIndex).toBe(-1);
  act(() => tabs[0]!.focus());
  press(tabs[0]!, 'ArrowRight');
  expect(document.activeElement).toBe(tabs[2]);
  expect(tabs[2]!.getAttribute('aria-selected')).toBe('true');
  const panel = host.querySelector('[role="tabpanel"]')!;
  expect(panel.id).toBe(tabs[2]!.getAttribute('aria-controls'));
  expect(panel.getAttribute('aria-labelledby')).toBe(tabs[2]!.id);
  expect(panel.textContent).toBe('Panel two');
  expect(panel.className).toBe('');
  press(tabs[2]!, 'End');
  expect(document.activeElement).toBe(tabs[3]);
  press(tabs[3]!, 'ArrowRight');
  expect(document.activeElement).toBe(tabs[0]);
  press(tabs[0]!, 'ArrowLeft');
  expect(document.activeElement).toBe(tabs[3]);
  press(tabs[3]!, 'Home');
  expect(document.activeElement).toBe(tabs[0]);
  expect(host.querySelectorAll('[role="tab"][tabindex="0"]')).toHaveLength(1);
});
it('uses RTL horizontal keys and keeps vertical keys on vertical lists', () => {
  let host = render(<Example direction="rtl" />);
  let tabs = host.querySelectorAll<HTMLButtonElement>('[role="tab"]');
  act(() => tabs[0]!.focus());
  press(tabs[0]!, 'ArrowRight');
  expect(document.activeElement).toBe(tabs[3]);
  press(tabs[3]!, 'ArrowLeft');
  expect(document.activeElement).toBe(tabs[0]);
  act(() => root.unmount());
  host.remove();
  host = render(<Example orientation="vertical" />);
  tabs = host.querySelectorAll<HTMLButtonElement>('[role="tab"]');
  expect(host.querySelector('[role="tablist"]')!.getAttribute('aria-orientation')).toBe('vertical');
  act(() => tabs[0]!.focus());
  press(tabs[0]!, 'ArrowRight');
  expect(document.activeElement).toBe(tabs[0]);
  press(tabs[0]!, 'ArrowDown');
  expect(document.activeElement).toBe(tabs[2]);
  press(tabs[2]!, 'ArrowUp');
  expect(document.activeElement).toBe(tabs[0]);
});
it('follows responsive list orientation without applying styles', () => {
  const host = render(<Example orientation="auto" />);
  const list = host.querySelector<HTMLElement>('[role="tablist"]')!;
  act(() => {
    list.style.flexDirection = 'column';
    window.dispatchEvent(new Event('resize'));
  });
  expect(list.getAttribute('aria-orientation')).toBe('vertical');
  act(() => {
    list.style.flexDirection = 'row';
    window.dispatchEvent(new Event('resize'));
  });
  expect(list.getAttribute('aria-orientation')).toBe('horizontal');
});
it('preserves caller cancellation, modified keys and sibling action behavior', () => {
  const change = vi.fn();
  const action = vi.fn();
  const host = render(
    <TabsRoot value="one" onValueChange={change} items={['one', 'two']}>
      <TabsList unstyled>
        <TabsTrigger
          unstyled
          value="one"
          onKeyDown={(event) => event.preventDefault()}
          onClick={(event) => event.preventDefault()}
        >
          One
        </TabsTrigger>
        <TabsTrigger unstyled value="two">
          Two
        </TabsTrigger>
        <button onClick={action}>Close</button>
      </TabsList>
    </TabsRoot>,
  );
  const [one, two, close] = host.querySelectorAll<HTMLButtonElement>('button');
  act(() => {
    one!.focus();
    one!.click();
  });
  press(one!, 'ArrowRight');
  expect(change).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(one);
  act(() => two!.focus());
  press(two!, 'ArrowLeft', { altKey: true });
  expect(document.activeElement).toBe(two);
  expect(change).not.toHaveBeenCalled();
  act(() => close!.focus());
  press(close!, 'Home');
  expect(document.activeElement).toBe(close);
  expect(change).not.toHaveBeenCalled();
  act(() => close!.click());
  expect(action).toHaveBeenCalledOnce();
});
it('keeps tab actions out of form submission and provides a fallback tab stop for missing selection', () => {
  const submit = vi.fn((event: React.FormEvent) => event.preventDefault());
  const host = render(
    <form onSubmit={submit}>
      <TabsRoot
        value="missing"
        onValueChange={() => {}}
        items={[{ value: 'one', disabled: true }, 'two']}
      >
        <TabsList unstyled>
          <TabsTrigger unstyled value="one">
            One
          </TabsTrigger>
          <TabsTrigger unstyled value="two">
            Two
          </TabsTrigger>
        </TabsList>
      </TabsRoot>
    </form>,
  );
  const [one, two] = host.querySelectorAll<HTMLButtonElement>('[role="tab"]');
  expect(one!.tabIndex).toBe(-1);
  expect(two!.tabIndex).toBe(0);
  act(() => two!.click());
  expect(submit).not.toHaveBeenCalled();
});

it('does not recover navigation focus from an unrelated portaled control', () => {
  function Example() {
    const [open, setOpen] = useState(true);
    return (
      <TabsRoot value="one" onValueChange={() => {}} items={['one', 'two']}>
        <TabsList unstyled>
          <TabsTrigger unstyled value="one">
            One
          </TabsTrigger>
          <TabsTrigger unstyled value="two">
            Two
          </TabsTrigger>
          {open &&
            createPortal(
              <button onClick={() => setOpen(false)}>Close popup</button>,
              document.body,
            )}
        </TabsList>
      </TabsRoot>
    );
  }
  render(<Example />);
  const popup = [...document.querySelectorAll<HTMLButtonElement>('button')].find(
    (button) => button.textContent === 'Close popup',
  )!;
  act(() => {
    popup.focus();
    popup.click();
  });
  expect(document.activeElement).toBe(document.body);
});
