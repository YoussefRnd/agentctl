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
});
