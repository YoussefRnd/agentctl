import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { SessionEventRow, SessionWithCapabilities } from '@agentctl/shared';
import { useMessageQueueStore, type QueuedMessage } from '@/shared';
import { sessionKeys } from '@/shared/lib/queryKeys';
import { useAcceptedMessageQueue } from './useAcceptedMessageQueue';
import {
  acknowledgeSessionInput,
  sendSessionInput,
  updateOptimisticDelivery,
} from './messageDelivery';

const EMPTY_QUEUED_MESSAGES: QueuedMessage[] = [];

/** Owns the client outbox, durable acceptance reconciliation, and delivery retries. */
export function useSessionMessageQueue(
  sessionId: string,
  events: SessionEventRow[],
  sessionData: SessionWithCapabilities | undefined,
  isConnected: boolean,
  isLoadingEvents: boolean,
) {
  const queryClient = useQueryClient();
  const acceptedQueue = useAcceptedMessageQueue(sessionId);
  const queuedMessages = useMessageQueueStore(
    (s) => s.queuedMessages[sessionId] ?? EMPTY_QUEUED_MESSAGES,
  );
  const displayQueue = useMemo(
    () => [
      ...acceptedQueue.queuedMessages,
      ...queuedMessages.filter(
        (message) => !acceptedQueue.queuedMessages.some((accepted) => accepted.id === message.id),
      ),
    ],
    [acceptedQueue.queuedMessages, queuedMessages],
  );
  const enqueueQueuedMessage = useMessageQueueStore((s) => s.enqueueMessage);
  const dequeueQueuedMessage = useMessageQueueStore((s) => s.dequeueMessage);
  const reorderQueuedMessagesForSession = useMessageQueueStore((s) => s.reorderQueuedMessages);
  const moveQueuedMessageForSession = useMessageQueueStore((s) => s.moveQueuedMessage);
  const enqueueMessage = useCallback(
    (text: string, attachmentIds?: string[], optimisticEventId?: number, id?: string) =>
      enqueueQueuedMessage(sessionId, text, attachmentIds, optimisticEventId, id),
    [enqueueQueuedMessage, sessionId],
  );
  const dequeueMessage = useCallback(
    (id: string) => {
      if (
        acceptedQueue.queuedMessages.some((message) => message.id === id) ||
        queryClient
          .getQueryData<SessionEventRow[]>(sessionKeys.events(sessionId))
          ?.some(
            (event) => event.id > 0 && event.type === 'text' && event.data.clientMessageId === id,
          )
      )
        void acceptedQueue.changeMessage(id, 'cancel');
      else {
        const message = useMessageQueueStore
          .getState()
          .queuedMessages[sessionId]?.find((item) => item.id === id);
        if (!message || message.status === 'sending') return;
        dequeueQueuedMessage(sessionId, id);
        if (message.optimisticEventId !== undefined)
          updateOptimisticDelivery(queryClient, sessionId, message.optimisticEventId, 'cancelled');
      }
    },
    [dequeueQueuedMessage, sessionId, acceptedQueue, queryClient],
  );
  const editQueuedMessage = useCallback(
    async (id: string, text: string) => {
      if (
        acceptedQueue.queuedMessages.some((message) => message.id === id) ||
        queryClient
          .getQueryData<SessionEventRow[]>(sessionKeys.events(sessionId))
          ?.some(
            (event) => event.id > 0 && event.type === 'text' && event.data.clientMessageId === id,
          )
      )
        return acceptedQueue.changeMessage(id, 'edit', text);
      const queue = useMessageQueueStore.getState();
      const message = queue.queuedMessages[sessionId]?.find((item) => item.id === id);
      if (!message || !queue.editMessage(sessionId, id, text)) return false;
      queryClient.setQueryData<SessionEventRow[]>(sessionKeys.events(sessionId), (old = []) =>
        old.map((event) =>
          event.id === message.optimisticEventId && event.type === 'text'
            ? { ...event, data: { ...event.data, content: text.trim() } }
            : event,
        ),
      );
      return true;
    },
    [acceptedQueue, sessionId, queryClient],
  );
  const reorderQueuedMessages = useCallback(
    (newQueue: QueuedMessage[]) => reorderQueuedMessagesForSession(sessionId, newQueue),
    [reorderQueuedMessagesForSession, sessionId],
  );
  const moveQueuedMessage = useCallback(
    (index: number, direction: 'up' | 'down') => {
      const message = displayQueue[index];
      const neighbor = displayQueue[index + (direction === 'up' ? -1 : 1)];
      if (
        !message ||
        !neighbor ||
        !!message.accepted !== !!neighbor.accepted ||
        [message, neighbor].some((item) => item.status === 'sending' || item.status === 'unknown')
      )
        return;
      if (message?.accepted) void acceptedQueue.changeMessage(message.id, direction);
      else
        moveQueuedMessageForSession(
          sessionId,
          queuedMessages.findIndex((item) => item.id === message?.id),
          direction,
        );
    },
    [moveQueuedMessageForSession, sessionId, acceptedQueue, displayQueue, queuedMessages],
  );
  const currentSessionRef = useRef(sessionId);
  currentSessionRef.current = sessionId;
  const awaitingQueuedTurnRef = useRef(false);
  const queuedTurnStartEventIdRef = useRef(0);
  const latestEventId = useMemo(
    () => events.reduce((max, event) => Math.max(max, event.id), 0),
    [events],
  );
  const latestTurnEndId = useMemo(
    () =>
      events.reduce(
        (max, event) =>
          event.type === 'status' && event.data.status === 'turn_end'
            ? Math.max(max, event.id)
            : max,
        0,
      ),
    [events],
  );

  useEffect(() => {
    awaitingQueuedTurnRef.current = false;
    queuedTurnStartEventIdRef.current = 0;
  }, [sessionId]);

  const retryQueuedMessage = useCallback(
    (id: string) => {
      const message = useMessageQueueStore
        .getState()
        .queuedMessages[sessionId]?.find((candidate) => candidate.id === id);
      if (!message || message.status === 'sending' || message.status === 'unknown') return;
      awaitingQueuedTurnRef.current = false;
      useMessageQueueStore.getState().setMessageStatus(sessionId, id, 'queued');
      if (message.optimisticEventId !== undefined)
        updateOptimisticDelivery(queryClient, sessionId, message.optimisticEventId, 'queued');
      queryClient.setQueryData<SessionWithCapabilities>(sessionKeys.detail(sessionId), (old) =>
        old?.session.status === 'error'
          ? { ...old, session: { ...old.session, status: 'idle' } }
          : old,
      );
    },
    [sessionId, queryClient],
  );

  const retryMessage = useCallback(
    (eventId: number) => {
      const message = useMessageQueueStore
        .getState()
        .queuedMessages[sessionId]?.find((candidate) => candidate.optimisticEventId === eventId);
      if (message) {
        retryQueuedMessage(message.id);
        return;
      }
      const event = queryClient
        .getQueryData<SessionEventRow[]>(sessionKeys.events(sessionId))
        ?.find((candidate) => candidate.id === eventId);
      if (
        eventId > 0 &&
        event?.type === 'text' &&
        event.data.deliveryStatus === 'failed' &&
        (!event.data.deliveryFailure ||
          (event.data.deliveryFailure.actions.includes('retry') &&
            ['not_sent', 'rejected'].includes(event.data.deliveryFailure.delivery)))
      ) {
        // A rejected send is a new, explicitly requested attempt, not a replay
        // of its durable receipt. Never offer this path for uncertain delivery.
        void acceptedQueue.resume().then((resumed) => {
          if (resumed) enqueueMessage(event.data.content, event.data.attachmentIds);
        });
        return;
      }
      if (eventId < 0 && event?.type === 'text' && event.data.deliveryStatus === 'failed') {
        const id = enqueueMessage(
          event.data.content,
          event.data.attachmentIds,
          eventId,
          event.data.clientMessageId,
        );
        retryQueuedMessage(id);
      }
    },
    [sessionId, queryClient, enqueueMessage, retryQueuedMessage, acceptedQueue],
  );

  useEffect(() => {
    const isIdle = sessionData?.session.status === 'idle';
    if (isIdle && latestTurnEndId > queuedTurnStartEventIdRef.current) {
      awaitingQueuedTurnRef.current = false;
    }
    if (!isIdle) {
      if (sessionData?.session.status) awaitingQueuedTurnRef.current = false;
      return;
    }
    if (
      !isConnected ||
      isLoadingEvents ||
      awaitingQueuedTurnRef.current ||
      queuedMessages.length === 0
    )
      return;

    const nextMessage = queuedMessages[0];
    if (
      nextMessage.status === 'failed' ||
      nextMessage.status === 'sending' ||
      nextMessage.status === 'unknown'
    )
      return;
    awaitingQueuedTurnRef.current = true;
    queuedTurnStartEventIdRef.current = latestEventId;
    const setDelivery = (status: 'queued' | 'sending' | 'accepted' | 'failed', error?: string) => {
      if (nextMessage.optimisticEventId !== undefined) {
        updateOptimisticDelivery(
          queryClient,
          sessionId,
          nextMessage.optimisticEventId,
          status === 'sending' ? 'queued' : status,
          error,
        );
      }
    };
    const markFailed = (error: unknown) => {
      const accepted = queryClient
        .getQueryData<SessionEventRow[]>(sessionKeys.events(sessionId))
        ?.find(
          (event) =>
            event.id > 0 && event.type === 'text' && event.data.clientMessageId === nextMessage.id,
        );
      if (accepted) {
        if (currentSessionRef.current === sessionId)
          queuedTurnStartEventIdRef.current = accepted.id;
        dequeueQueuedMessage(sessionId, nextMessage.id);
        void queryClient.invalidateQueries({ queryKey: ['session-execution', sessionId] });
        void queryClient.invalidateQueries({ queryKey: sessionKeys.detail(sessionId) });
        return;
      }
      if (currentSessionRef.current === sessionId) {
        awaitingQueuedTurnRef.current = false;
      }
      const message = error instanceof Error ? error.message : String(error);
      useMessageQueueStore
        .getState()
        .setMessageStatus(sessionId, nextMessage.id, 'failed', message);
      setDelivery('failed', message);
      toast.error('Failed to send queued message', {
        description: message,
        action: {
          label: 'Retry',
          onClick: () => retryQueuedMessage(nextMessage.id),
        },
      });
      void queryClient.invalidateQueries({ queryKey: sessionKeys.detail(sessionId) });
    };
    useMessageQueueStore.getState().setMessageStatus(sessionId, nextMessage.id, 'sending');
    setDelivery('sending');
    queueMicrotask(() => {
      void sendSessionInput(sessionId, nextMessage.text, nextMessage.attachmentIds, nextMessage.id)
        .then((eventId) => {
          if (currentSessionRef.current === sessionId) queuedTurnStartEventIdRef.current = eventId;
          dequeueQueuedMessage(sessionId, nextMessage.id);
          acknowledgeSessionInput(
            queryClient,
            sessionId,
            nextMessage.id,
            eventId,
            nextMessage.optimisticEventId,
            'queued',
          );
          void queryClient.invalidateQueries({ queryKey: ['session-execution', sessionId] });
          void queryClient.invalidateQueries({ queryKey: sessionKeys.detail(sessionId) });
        })
        .catch(markFailed);
    });
  }, [
    sessionData?.session.status,
    queuedMessages,
    latestEventId,
    latestTurnEndId,
    sessionId,
    queryClient,
    dequeueMessage,
    dequeueQueuedMessage,
    enqueueMessage,
    retryQueuedMessage,
    isConnected,
    isLoadingEvents,
  ]);

  return {
    acceptedQueue,
    displayQueue,
    enqueueMessage,
    dequeueMessage,
    retryQueuedMessage,
    retryMessage,
    editQueuedMessage,
    reorderQueuedMessages,
    moveQueuedMessage,
  };
}
