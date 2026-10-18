import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it } from 'vite-plus/test';
import { ShortcutsDialog } from './ShortcutsDialog';
import { useShellStore } from './model/useShellStore';
import { MODIFIER_KEY } from '@/shared/lib/platform';

let root: Root | undefined;
afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  useShellStore.getState().closeShortcuts();
  document.body.innerHTML = '';
});

function render() {
  const container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() => {
    root!.render(<ShortcutsDialog />);
    useShellStore.getState().openShortcuts();
  });
  return document.querySelector<HTMLInputElement>('[aria-label="Search keyboard shortcuts"]')!;
}
function search(value: string) {
  const input = document.querySelector<HTMLInputElement>(
    '[aria-label="Search keyboard shortcuts"]',
  )!;
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
function filter(label: string) {
  act(() =>
    [...document.querySelectorAll<HTMLButtonElement>('[aria-pressed]')]
      .find((button) => button.textContent === label)!
      .click(),
  );
}
function rows() {
  return [...document.querySelectorAll<HTMLLIElement>('li')];
}

it('focuses search and finds action names and platform key combinations with shared fuzzy matching', () => {
  const input = render();
  expect(document.activeElement).toBe(input);
  search('cmplt');
  expect(rows()[0].textContent).toContain('Command palette');
  expect(rows()[0].querySelectorAll('mark').length).toBeGreaterThan(0);
  search(MODIFIER_KEY + '+K');
  expect(rows()).toHaveLength(1);
  expect(rows()[0].textContent).toContain('Command palette');
});

it('filters categories and searches within the selected category', () => {
  const input = render();
  filter('Review');
  expect(document.activeElement).toBe(input);
  expect(rows()).toHaveLength(4);
  expect(rows().some((row) => row.textContent?.includes('Send message'))).toBe(false);
  search('cmt');
  expect(rows()).toHaveLength(1);
  expect(rows()[0].textContent).toContain('Commit changes');
  expect(document.querySelector('[aria-pressed="true"]')?.textContent).toBe('Review');
});

it('distinguishes simultaneous keys, alternatives, and the double Escape sequence', () => {
  render();
  const row = (text: string) => rows().find((item) => item.textContent?.includes(text))!;
  expect(row('Command palette').querySelector('[role="group"]')?.getAttribute('aria-label')).toBe(
    MODIFIER_KEY + '+K',
  );
  expect(row('New line').querySelector('[role="group"]')?.getAttribute('aria-label')).toBe(
    'Shift+Enter',
  );
  expect(row('Accept suggestion').querySelector('[role="group"]')?.getAttribute('aria-label')).toBe(
    'Tab or Enter',
  );
  expect(
    row('Stop running agent').querySelector('[role="group"]')?.getAttribute('aria-label'),
  ).toBe('Esc then Esc');
});

it('shows an empty state and resets search and category when reopened', () => {
  render();
  filter('Composer');
  search('zzzzzz');
  expect(rows()).toHaveLength(0);
  expect(document.body.textContent).toContain('No shortcuts match “zzzzzz”');
  act(() =>
    document.querySelector<HTMLButtonElement>('[aria-label="Close keyboard shortcuts"]')!.click(),
  );
  expect(useShellStore.getState().isShortcutsOpen).toBe(false);
  act(() => useShellStore.getState().openShortcuts());
  expect(
    document.querySelector<HTMLInputElement>('[aria-label="Search keyboard shortcuts"]')?.value,
  ).toBe('');
  expect(document.querySelector('[aria-pressed="true"]')?.textContent).toBe('All');
  expect(rows()).toHaveLength(16);
});

it('closes with Escape', () => {
  const input = render();
  act(() => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  expect(useShellStore.getState().isShortcutsOpen).toBe(false);
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});
