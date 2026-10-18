import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vite-plus/test';
import { useComposerState } from './useComposerState';
import { ComposerInput } from '../ui/ComposerInput';

vi.mock('@/features/settings', () => ({
  useSettingsOverlayStore: { getState: () => ({ openMcpSettings: vi.fn() }) },
}));
vi.mock('@/shared/stores/useWorkbenchStore', () => ({
  useWorkbenchStore: { getState: () => ({ setWorkbenchTab: vi.fn() }) },
}));

let root: ReturnType<typeof createRoot>;
let container: HTMLDivElement;
let state: ReturnType<typeof useComposerState>;
function Harness() {
  state = useComposerState({
    onSend: vi.fn(),
    sessionId: '',
    draftKey: '',
    sessionData: null,
    events: [],
    providers: [],
  });
  return <ComposerInput state={state}>{null}</ComposerInput>;
}
beforeEach(async () => {
  HTMLElement.prototype.scrollIntoView = vi.fn();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root.render(<Harness />));
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

it('uses fuzzy abbreviations for actual composer commands', async () => {
  await act(async () => state.handleInputChange('/trm'));
  expect(state.filteredCommands.map((command) => command.name)).toEqual(['terminal']);
  expect(document.querySelector('[role="option"]')?.textContent).toContain('/terminal');
});
it('keeps an empty search visible and hides suggestions when command arguments begin', async () => {
  await act(async () => state.handleInputChange('/xyz'));
  expect(state.showSlashMenu).toBe(true);
  expect(document.querySelector('[aria-label="Slash commands"]')?.textContent).toContain(
    'No commands match',
  );
  await act(async () => state.handleInputChange('/terminal argument'));
  expect(state.showSlashMenu).toBe(false);
  expect(document.querySelector('[aria-label="Slash commands"]')).toBeNull();
});
