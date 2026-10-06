import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { persistentStorage } from '../lib/persistentStorage';

export interface QueuedMessage {
  id: string;
  text: string;
  attachmentIds?: string[];
  optimisticEventId?: number;
  status?: 'queued' | 'sending' | 'failed' | 'unknown';
  accepted?: boolean;
  error?: string;
}

interface MessageQueueState {
  queuedMessages: Record<string, QueuedMessage[]>;
  enqueueMessage: (
    sessionId: string,
    text: string,
    attachmentIds?: string[],
    optimisticEventId?: number,
    id?: string,
    status?: QueuedMessage['status'],
  ) => string;
  setMessageStatus: (
    sessionId: string,
    id: string,
    status: NonNullable<QueuedMessage['status']>,
    error?: string,
  ) => void;
  dequeueMessage: (sessionId: string, id: string) => void;
  reorderQueuedMessages: (sessionId: string, newQueue: QueuedMessage[]) => void;
  moveQueuedMessage: (sessionId: string, index: number, direction: 'up' | 'down') => void;
  clearQueue: () => void;
}

export const useMessageQueueStore = create<MessageQueueState>()(
  persist(
    (set) => ({
      queuedMessages: {},

      enqueueMessage: (
        sessionId,
        text,
        attachmentIds,
        optimisticEventId,
        id = crypto.randomUUID(),
        status = 'queued',
      ) => {
        set((state) => ({
          queuedMessages: {
            ...state.queuedMessages,
            [sessionId]: [
              ...(state.queuedMessages[sessionId] ?? []).filter((message) => message.id !== id),
              { id, text, attachmentIds, optimisticEventId, status },
            ],
          },
        }));
        return id;
      },

      setMessageStatus: (sessionId, id, status, error) =>
        set((state) => ({
          queuedMessages: {
            ...state.queuedMessages,
            [sessionId]: (state.queuedMessages[sessionId] ?? []).map((message) =>
              message.id === id ? { ...message, status, error } : message,
            ),
          },
        })),

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
          if (
            index < 0 ||
            index >= queue.length ||
            targetIndex < 0 ||
            targetIndex >= queue.length
          ) {
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
    }),
    {
      name: 'agentctl-message-outbox',
      version: 1,
      storage: persistentStorage,
      partialize: (state) => ({ queuedMessages: state.queuedMessages }),
      merge: (saved, current) => {
        const queues = (saved as Partial<MessageQueueState> | undefined)?.queuedMessages;
        if (!queues || typeof queues !== 'object') return current;
        const queuedMessages: MessageQueueState['queuedMessages'] = {};
        for (const [sessionId, messages] of Object.entries(queues)) {
          if (!Array.isArray(messages)) continue;
          queuedMessages[sessionId] = messages
            .filter(
              (message) =>
                message &&
                typeof message.id === 'string' &&
                typeof message.text === 'string' &&
                (!message.attachmentIds ||
                  (Array.isArray(message.attachmentIds) &&
                    message.attachmentIds.every((id: unknown) => typeof id === 'string'))),
            )
            .map((message) => ({
              ...message,
              status: message.status === 'failed' ? 'failed' : 'queued',
            }));
        }
        return { ...current, queuedMessages };
      },
    },
  ),
);
