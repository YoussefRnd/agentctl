import { afterEach, describe, expect, test } from 'vite-plus/test';
import { useReviewUIStore } from './useReviewUIStore';

const initialState = useReviewUIStore.getState();

afterEach(() => {
  useReviewUIStore.setState(initialState, true);
});

describe('useReviewUIStore', () => {
  test('focuses a file using the turn that owns it', () => {
    const turnSelection = {
      sessionId: 'session-1',
      files: ['src/older-turn.ts', 'src/other.ts'],
    };

    useReviewUIStore.getState().focusReviewFile('src/older-turn.ts', turnSelection);

    expect(useReviewUIStore.getState()).toMatchObject({
      reviewScope: 'this_turn',
      reviewTurnSelection: turnSelection,
      targetReviewFile: 'src/older-turn.ts',
    });
  });
});
