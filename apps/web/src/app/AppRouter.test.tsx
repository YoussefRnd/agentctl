// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { AppRouter } from './AppRouter.js';

afterEach(() => {
  document.body.innerHTML = '';
});

describe('AppRouter development routes', () => {
  it('renders the internal UI gallery at /_dev/ui', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={['/_dev/ui']}>
          <AppRouter />
        </MemoryRouter>,
      );
    });

    expect(container.querySelector('h1')?.textContent).toBe('UI gallery');
    expect(container.textContent).toContain('Buttons');
    expect(container.textContent).toContain('Feedback states');

    act(() => {
      root.unmount();
    });
  });
});
