import { afterEach, describe, expect, test } from 'vitest';
import { useWorkbenchStore } from './useWorkbenchStore';

const initialState = useWorkbenchStore.getState();

afterEach(() => {
  useWorkbenchStore.setState(initialState, true);
});

describe('useWorkbenchStore', () => {
  test('opens, closes, and moves tabs correctly', () => {
    expect(useWorkbenchStore.getState().openWorkbenchTabs).toEqual([
      'changes',
      'terminal',
      'status',
    ]);

    useWorkbenchStore.getState().moveWorkbenchTab(2, 0);
    expect(useWorkbenchStore.getState().openWorkbenchTabs).toEqual([
      'status',
      'changes',
      'terminal',
    ]);

    useWorkbenchStore.getState().setWorkbenchTab('status');
    useWorkbenchStore.getState().closeWorkbenchTab('status');
    expect(useWorkbenchStore.getState().openWorkbenchTabs).toEqual(['changes', 'terminal']);
    expect(useWorkbenchStore.getState().workbenchTab).toBe('changes');
  });
});
