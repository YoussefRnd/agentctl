import { afterEach, describe, expect, test } from 'vitest';
import { useUIStore } from './useUIStore';

const initialState = useUIStore.getState();

afterEach(() => {
  useUIStore.setState(initialState, true);
});

describe('useUIStore review focus', () => {
  test('focuses a file using the turn that owns it', () => {
    const turnSelection = {
      sessionId: 'session-1',
      files: ['src/older-turn.ts', 'src/other.ts'],
    };

    useUIStore.getState().focusReviewFile('src/older-turn.ts', turnSelection);

    expect(useUIStore.getState()).toMatchObject({
      workbenchTab: 'changes',
      isWorkbenchOpen: true,
      reviewScope: 'this_turn',
      reviewTurnSelection: turnSelection,
      targetReviewFile: 'src/older-turn.ts',
    });
  });

  test('opens, closes, and moves workbench tabs correctly', () => {
    // Initial state: ['changes', 'terminal', 'status']
    expect(useUIStore.getState().openWorkbenchTabs).toEqual(['changes', 'terminal', 'status']);

    // Move 'status' (index 2) to index 0
    useUIStore.getState().moveWorkbenchTab(2, 0);
    expect(useUIStore.getState().openWorkbenchTabs).toEqual(['status', 'changes', 'terminal']);

    // Close active tab ('status') -> automatically switches to adjacent tab ('changes')
    useUIStore.getState().setWorkbenchTab('status');
    useUIStore.getState().closeWorkbenchTab('status');
    expect(useUIStore.getState().openWorkbenchTabs).toEqual(['changes', 'terminal']);
    expect(useUIStore.getState().workbenchTab).toBe('changes');

    // Reopen 'status'
    useUIStore.getState().openWorkbenchTab('status');
    expect(useUIStore.getState().openWorkbenchTabs).toEqual(['changes', 'terminal', 'status']);
    expect(useUIStore.getState().workbenchTab).toBe('status');
  });
});
