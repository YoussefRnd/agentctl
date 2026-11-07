import { createHash } from 'node:crypto';
import { act } from 'react';
import { useWorkbenchStore } from '@/shared/stores/useWorkbenchStore';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vite-plus/test';
import { Workbench } from './Workbench';
import type { ReviewComposerActions } from '@/features/review';
vi.mock('@/features/sessions', () => ({
  useSession: () => ({ reviewData: { files: [] }, refetchReview: () => {} }),
}));
vi.mock('@/features/review', () => ({ ReviewView: () => <p>Review body</p> }));
vi.mock('./terminal/InteractiveTerminal', () => ({
  InteractiveTerminal: () => <p>Terminal body</p>,
}));
vi.mock('./StatusPane', () => ({ StatusPane: () => <p>Status body</p> }));
let root: Root;
afterEach(() => {
  act(() => root?.unmount());
  document.body.innerHTML = '';
});
function appearance(node: Element): unknown {
  return [
    node.tagName,
    node.getAttribute('class'),
    node.getAttribute('style'),
    [...node.children].map(appearance),
  ];
}
it('preserves the existing workbench tab and panel appearance', () => {
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() =>
    root.render(
      <Workbench
        composerActions={{} as ReviewComposerActions}
        isOpen
        tab="status"
        openTabs={['changes', 'terminal', 'status']}
        onTabChange={() => {}}
      />,
    ),
  );
  expect(
    createHash('sha256')
      .update(JSON.stringify(appearance(host)))
      .digest('hex'),
  ).toMatchInlineSnapshot(`"5198fab2c2edcffe3fed7120b7cc28b4bc2716aef902e834c4674929da22eccf"`);
});

function renderLiveWorkbench() {
  useWorkbenchStore.setState({
    workbenchTab: 'status',
    openWorkbenchTabs: ['changes', 'terminal', 'status'],
  });
  function Live() {
    const active = useWorkbenchStore((state) => state.workbenchTab);
    const setActive = useWorkbenchStore((state) => state.setWorkbenchTab);
    return (
      <Workbench
        composerActions={{} as ReviewComposerActions}
        isOpen
        tab={active}
        onTabChange={setActive}
      />
    );
  }
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() => root.render(<Live />));
  return host;
}
function key(target: Element, key: string, extra: KeyboardEventInit = {}) {
  act(() =>
    target.dispatchEvent(
      new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...extra }),
    ),
  );
}
it('shares keyboard focus and selection while respecting modified reorder shortcuts', async () => {
  const host = renderLiveWorkbench();
  const status = host.querySelector<HTMLButtonElement>('[role="tab"][aria-selected="true"]')!;
  act(() => status.focus());
  key(status, 'Home');
  expect(document.activeElement?.textContent).toBe('Changes');
  expect(useWorkbenchStore.getState().workbenchTab).toBe('changes');
  const changes = document.activeElement!;
  key(changes, 'ArrowRight', { altKey: true });
  expect(useWorkbenchStore.getState().openWorkbenchTabs).toEqual(['terminal', 'changes', 'status']);
  expect(document.activeElement).toBe(changes);
  expect(useWorkbenchStore.getState().workbenchTab).toBe('changes');
  key(changes, 'ArrowLeft');
  expect(document.activeElement?.textContent).toBe('Terminal');
  expect(useWorkbenchStore.getState().workbenchTab).toBe('terminal');
  await act(async () => {});
  const active = host.querySelector<HTMLButtonElement>('[role="tab"][aria-selected="true"]')!;
  expect(
    document.getElementById(active.getAttribute('aria-controls')!)?.getAttribute('aria-labelledby'),
  ).toBe(active.id);
});
it('restores navigation focus when the active tab closes and keeps add reachable after the final close', () => {
  const host = renderLiveWorkbench();
  const close = host.querySelector<HTMLButtonElement>('[aria-label="Close Status tab"]')!;
  act(() => {
    close.focus();
    close.click();
  });
  expect(useWorkbenchStore.getState().workbenchTab).toBe('terminal');
  expect(document.activeElement?.getAttribute('role')).toBe('tab');
  expect(document.activeElement?.textContent).toBe('Terminal');
  act(() => {
    const button = host.querySelector<HTMLButtonElement>('[aria-label="Close Terminal tab"]')!;
    button.focus();
    button.click();
  });
  act(() => {
    const button = host.querySelector<HTMLButtonElement>('[aria-label="Close Changes tab"]')!;
    button.focus();
    button.click();
  });
  expect(useWorkbenchStore.getState().workbenchTab).toBeNull();
  expect(host.textContent).toContain('No open workbench tabs');
  expect(document.activeElement?.getAttribute('aria-label')).toBe('Add tab');
});
it('preserves drag reordering and middle-click close', () => {
  const host = renderLiveWorkbench();
  const tabs = host.querySelectorAll<HTMLButtonElement>('[role="tab"]');
  const source = tabs[0]!.parentElement!;
  const destination = tabs[2]!.parentElement!;
  const dataTransfer = { setData: vi.fn(), effectAllowed: '', dropEffect: '' };
  const drag = (element: Element, type: string) => {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'dataTransfer', { value: dataTransfer });
    act(() => element.dispatchEvent(event));
  };
  drag(source, 'dragstart');
  drag(destination, 'dragenter');
  drag(destination, 'drop');
  expect(useWorkbenchStore.getState().openWorkbenchTabs).toEqual(['terminal', 'status', 'changes']);
  expect(dataTransfer.setData).toHaveBeenCalledWith('text/plain', 'changes');
  act(() =>
    source.dispatchEvent(
      new MouseEvent('mousedown', { button: 1, bubbles: true, cancelable: true }),
    ),
  );
  expect(useWorkbenchStore.getState().openWorkbenchTabs).toEqual(['terminal', 'status']);
});
