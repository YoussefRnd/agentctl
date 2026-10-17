import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, test, vi } from 'vitest';
import { UpdateProvider, useUpdateContext } from './UpdateContext';
import type { UpdateState } from '@/electron';

test('keeps newer update events over a delayed snapshot and unsubscribes on disposal', async () => {
  let resolve!: (value: UpdateState) => void;
  const initial = new Promise<UpdateState>((done) => {
    resolve = done;
  });
  let notify!: (value: UpdateState) => void;
  const unsubscribe = vi.fn();
  const previous = window.electronAPI;
  Object.defineProperty(window, 'electronAPI', {
    configurable: true,
    value: {
      update: {
        getState: () => initial,
        onUpdate: (listener: typeof notify) => {
          notify = listener;
          return unsubscribe;
        },
      },
    },
  });
  const root = createRoot(document.createElement('div'));
  let current!: UpdateState;
  function State() {
    current = useUpdateContext().state;
    return null;
  }
  try {
    act(() =>
      root.render(
        <UpdateProvider>
          <State />
        </UpdateProvider>,
      ),
    );
    const latest = { status: 'checking' } as UpdateState;
    act(() => notify(latest));
    await act(async () => resolve({ status: 'idle' }));
    expect(current).toEqual(latest);
    act(() => root.unmount());
    expect(unsubscribe).toHaveBeenCalledOnce();
    act(() => notify({ status: 'idle' }));
    expect(current).toEqual(latest);
  } finally {
    Object.defineProperty(window, 'electronAPI', { configurable: true, value: previous });
  }
});
