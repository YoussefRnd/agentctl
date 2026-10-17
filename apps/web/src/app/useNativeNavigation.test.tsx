import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { expect, it, vi } from 'vitest';
import { useNativeNavigation } from './useNativeNavigation.js';
it('navigates local native session links and removes subscriptions on unmount', () => {
  let onLink!: (url: string) => void;
  let onNavigate!: (path: string) => void;
  const disposeLink = vi.fn();
  const disposeNavigate = vi.fn();
  window.electronAPI = {
    onDeepLink: vi.fn((callback) => {
      onLink = callback;
      return disposeLink;
    }),
    onNavigate: vi.fn((callback) => {
      onNavigate = callback;
      return disposeNavigate;
    }),
  } as unknown as NonNullable<Window['electronAPI']>;
  function Example() {
    useNativeNavigation();
    return <span>{useLocation().pathname}</span>;
  }
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  try {
    act(() =>
      root.render(
        <MemoryRouter>
          <Example />
        </MemoryRouter>,
      ),
    );
    for (const value of ['https://example.com/sessions/wrong', 'garbage', 'agentctl:///settings'])
      act(() => onLink(value));
    expect(container.textContent).toBe('/');
    act(() => onLink('agentctl:///sessions/one'));
    expect(container.textContent).toBe('/sessions/one');
    act(() => onNavigate('//example.com'));
    expect(container.textContent).toBe('/sessions/one');
    act(() => root.unmount());
    expect(disposeLink).toHaveBeenCalledTimes(
      vi.mocked(window.electronAPI!.onDeepLink).mock.calls.length,
    );
    expect(disposeNavigate).toHaveBeenCalledTimes(
      vi.mocked(window.electronAPI!.onNavigate).mock.calls.length,
    );
  } finally {
    delete window.electronAPI;
    container.remove();
  }
});
