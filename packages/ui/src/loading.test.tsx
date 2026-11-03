import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vite-plus/test';
import { Button, IconButton, LoadingSkeleton, LoadingState, Progress, Spinner } from './index.js';

let root: Root;
function render(node: React.ReactNode) {
  if (!root) {
    const host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  }
  act(() => root.render(node));
}
afterEach(() => {
  act(() => root?.unmount());
  root = undefined as unknown as Root;
  document.body.innerHTML = '';
});

it('announces a loading region once and hides its decorative spinner', () => {
  render(<LoadingState message="Loading folders…" />);
  expect(document.querySelectorAll('[role="status"]')).toHaveLength(1);
  expect(document.querySelector('[role="status"]')?.textContent).toBe('Loading folders…');
  expect(document.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  render(<LoadingState variant="inline" message="Refreshing models…" />);
  expect(document.querySelectorAll('[role="status"]')).toHaveLength(1);
  expect(document.querySelector('[role="status"]')?.textContent).toBe('Refreshing models…');
});

it('gives a loading group one status while keeping pending content hidden and inert', () => {
  render(
    <LoadingSkeleton message="Loading sessions…">
      <div>First pending row</div>
      <div>Second pending row</div>
    </LoadingSkeleton>,
  );
  expect(document.querySelectorAll('[role="status"]')).toHaveLength(1);
  expect(document.querySelector('[role="status"] .sr-only')?.textContent).toBe('Loading sessions…');
  const content = document.querySelector('[aria-hidden="true"][inert]');
  expect(content?.textContent).toBe('First pending rowSecond pending row');
  expect(document.querySelectorAll('[aria-hidden="true"]')).toHaveLength(1);
});

it('labels standalone spinners without creating duplicate statuses for decorative spinners', () => {
  render(
    <>
      <Spinner label="Connecting provider…" />
      <Spinner aria-hidden="true" />
    </>,
  );
  expect(document.querySelectorAll('[role="status"]')).toHaveLength(1);
  expect(document.querySelector('[role="status"]')?.getAttribute('aria-label')).toBe(
    'Connecting provider…',
  );
  expect(document.querySelector('[aria-hidden="true"]')?.hasAttribute('aria-label')).toBe(false);
});

it('preserves action labels, blocks duplicate clicks while busy, and recovers after completion', () => {
  const click = vi.fn();
  const action = (busy: boolean) => (
    <Button isLoading={busy} onClick={click}>
      Save preferences
    </Button>
  );
  render(action(false));
  const button = document.querySelector('button')!;
  act(() => button.click());
  expect(click).toHaveBeenCalledTimes(1);
  const label = button.textContent;
  render(action(true));
  expect(button.disabled).toBe(true);
  expect(button.getAttribute('aria-busy')).toBe('true');
  expect(button.textContent).toBe(label);
  act(() => button.click());
  expect(click).toHaveBeenCalledTimes(1);
  render(action(false));
  expect(button.disabled).toBe(false);
  expect(button.hasAttribute('aria-busy')).toBe(false);
  act(() => button.click());
  expect(click).toHaveBeenCalledTimes(2);
});

it('keeps icon action names while busy without an extra spinner announcement', () => {
  render(
    <IconButton aria-label="Refresh models" isLoading>
      <span>Refresh</span>
    </IconButton>,
  );
  expect(document.querySelector('button')?.getAttribute('aria-label')).toBe('Refresh models');
  expect(document.querySelector('button')?.disabled).toBe(true);
  expect(document.querySelector('[role="status"]')).toBeNull();
});

it('reports actual progress, clamps invalid bounds and leaves unknown progress indeterminate', () => {
  render(<Progress label="Provider download" value={42} />);
  const bar = () => document.querySelector('[role="progressbar"]')!;
  expect(bar().getAttribute('aria-label')).toBe('Provider download');
  expect(bar().getAttribute('aria-valuenow')).toBe('42');
  render(<Progress label="Provider download" value={200} />);
  expect(bar().getAttribute('aria-valuenow')).toBe('100');
  render(<Progress label="Provider download" value={-5} />);
  expect(bar().getAttribute('aria-valuenow')).toBe('0');
  for (const value of [null, undefined, Number.NaN]) {
    render(<Progress label="Provider download" value={value} />);
    expect(bar().hasAttribute('aria-valuenow')).toBe(false);
  }
});
