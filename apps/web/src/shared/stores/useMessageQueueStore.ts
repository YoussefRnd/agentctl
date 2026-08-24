import { create } from 'zustand';

export interface QueuedMessage {
  id: string;
  text: string;
  attachmentIds?: string[];
}

interface MessageQueueState {
  queuedMessages: QueuedMessage[];
  enqueueMessage: (text: string, attachmentIds?: string[]) => void;
  dequeueMessage: (id: string) => void;
  reorderQueuedMessages: (newQueue: QueuedMessage[]) => void;
  moveQueuedMessage: (index: number, direction: 'up' | 'down') => void;
  clearQueue: () => void;
}

export const useMessageQueueStore = create<MessageQueueState>((set) => ({
  queuedMessages: [],

  enqueueMessage: (text: string, attachmentIds?: string[]) => {
    set((state) => ({
      queuedMessages: [...state.queuedMessages, { id: crypto.randomUUID(), text, attachmentIds }],
    }));
  },

  dequeueMessage: (id: string) => {
    set((state) => ({
      queuedMessages: state.queuedMessages.filter((msg) => msg.id !== id),
    }));
  },

  reorderQueuedMessages: (newQueue: QueuedMessage[]) => {
    set({ queuedMessages: newQueue });
  },

  moveQueuedMessage: (index: number, direction: 'up' | 'down') => {
    set((state) => {
      const targetIndex = direction === 'up' ? index - 1 : index + 1;
      if (targetIndex < 0 || targetIndex >= state.queuedMessages.length) return state;
      const next = [...state.queuedMessages];
      const [item] = next.splice(index, 1);
      next.splice(targetIndex, 0, item);
      return { queuedMessages: next };
    });
  },

  clearQueue: () => {
    set({ queuedMessages: [] });
  },
}));
