import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vite-plus/test';
import type { ProviderDiscovery } from '@agentctl/shared';
import { ProviderAuthDialog } from './LazyProviderAuthDialog';

const state = vi.hoisted(() => ({ pending: null as Promise<void> | null }));
vi.mock('./ProviderAuthDialog', () => ({
  ProviderAuthDialogContent: () => {
    if (state.pending) throw state.pending;
    return <div data-auth="ready">Authentication methods</div>;
  },
}));
const provider = {
  id: 'test-provider',
  label: 'Test Provider',
  authState: 'required',
} as ProviderDiscovery;
let root: Root;
afterEach(() => {
  act(() => root?.unmount());
  document.body.innerHTML = '';
  state.pending = null;
});
async function render() {
  const pending = Promise.withResolvers<void>();
  state.pending = pending.promise;
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  function Harness() {
    const [open, setOpen] = useState(true);
    return <ProviderAuthDialog provider={provider} isOpen={open} onClose={() => setOpen(false)} />;
  }
  await act(async () => {
    root.render(<Harness />);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return async () => {
    await act(async () => {
      state.pending = null;
      pending.resolve();
      await pending.promise;
    });
  };
}
it('keeps the authentication frame and focused close button when deferred content arrives', async () => {
  const finish = await render();
  const frame = document.querySelector('[role="dialog"]');
  const close = document.querySelector('[aria-label="Close dialog"]');
  expect(frame?.textContent).toContain('Test Provider Authentication');
  expect(document.querySelector('[role="status"] .sr-only')?.textContent).toBe(
    'Loading authentication…',
  );
  expect(document.activeElement).toBe(close);
  await finish();
  expect(document.querySelector('[role="dialog"]')).toBe(frame);
  expect(document.activeElement).toBe(close);
  expect(document.querySelector('[data-auth]')).not.toBeNull();
  expect(document.querySelector('[role="status"]')).toBeNull();
});
it('can dismiss pending authentication with Escape without reopening after load', async () => {
  const finish = await render();
  act(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  await finish();
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});
