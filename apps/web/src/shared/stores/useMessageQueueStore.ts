import { create } from 'zustand';

export interface QueuedMessage {
  id: string;
  text: string;
  attachmentIds?: string[];
}

interface MessageQueueState {
  queuedMessages: Record<string, QueuedMessage[]>;
  enqueueMessage: (sessionId: string, text: string, attachmentIds?: string[]) => void;
  dequeueMessage: (sessionId: string, id: string) => void;
  reorderQueuedMessages: (sessionId: string, newQueue: QueuedMessage[]) => void;
  moveQueuedMessage: (sessionId: string, index: number, direction: 'up' | 'down') => void;
  clearQueue: () => void;
}

export const useMessageQueueStore = create<MessageQueueState>((set) => ({
  queuedMessages: {},

  enqueueMessage: (sessionId, text, attachmentIds) => {
    set((state) => ({
      queuedMessages: {
        ...state.queuedMessages,
        [sessionId]: [
          ...(state.queuedMessages[sessionId] ?? []),
          { id: crypto.randomUUID(), text, attachmentIds },
        ],
      },
    }));
  },

  dequeueMessage: (sessionId, id) => {
    set((state) => ({
      queuedMessages: {
        ...state.queuedMessages,
        [sessionId]: (state.queuedMessages[sessionId] ?? []).filter((msg) => msg.id !== id),
      },
    }));
  },

  reorderQueuedMessages: (sessionId, newQueue) => {
    set((state) => ({ queuedMessages: { ...state.queuedMessages, [sessionId]: newQueue } }));
  },

  moveQueuedMessage: (sessionId, index, direction) => {
    set((state) => {
      const queue = state.queuedMessages[sessionId] ?? [];
      const targetIndex = direction === 'up' ? index - 1 : index + 1;
      if (index < 0 || index >= queue.length || targetIndex < 0 || targetIndex >= queue.length) {
        return state;
      }
      const next = [...queue];
      const [item] = next.splice(index, 1);
      next.splice(targetIndex, 0, item);
      return { queuedMessages: { ...state.queuedMessages, [sessionId]: next } };
    });
  },

  clearQueue: () => {
    set({ queuedMessages: {} });
  },
}));
