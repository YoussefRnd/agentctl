import { sessionKeys, projectKeys } from '@/shared/lib/queryKeys';
import { useState, useRef, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { rewindSession, undoRewind } from '@agentctl/api-client';
import type { SessionEventRow } from '@agentctl/shared';
import {
  useOpenWorkspaceFile,
  type RewindMode,
  type useSessionActions,
  type useSessionStream,
} from '@/features/sessions';
import { useReviewUIStore } from '@/features/review';
import { useWorkbenchStore } from '@/shared/stores/useWorkbenchStore';

/** Serializes history mutations while retaining the visible feed until durable refresh. */
export function useConversationHistory({
  sessionId,
  events,
  visibleEvents,
  handleSend,
  editQueuedMessage,
}: {
  sessionId: string;
  events: SessionEventRow[];
  visibleEvents?: SessionEventRow[];
  handleSend: ReturnType<typeof useSessionActions>['handleSend'];
  editQueuedMessage: ReturnType<typeof useSessionStream>['editQueuedMessage'];
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [confirmRewind, setConfirmRewind] = useState<{
    eventId: number;
    mode: RewindMode;
    messageCount?: number;
    input: string;
  } | null>(null);

  const [isRewindDialogOpen, setIsRewindDialogOpen] = useState(false);
  const [isRewinding, setIsRewinding] = useState(false);
  const [rewindError, setRewindError] = useState<string | null>(null);
  const historyMutationRef = useRef(false);
  const historySnapshotRef = useRef<{ sessionId: string; events: typeof events } | null>(null);
  const [isEditingHistory, setIsEditingHistory] = useState(false);

  const [rewindUndoState, setRewindUndoState] = useState<{
    eventId: number;
    mode: RewindMode;
    restoredFiles?: Array<{
      path: string;
      status: 'added' | 'modified' | 'deleted';
      additions?: number;
      deletions?: number;
    }>;
  } | null>(null);
  const [isUndoing, setIsUndoing] = useState(false);
  const [isDiffExpanded, setIsDiffExpanded] = useState(false);

  const setWorkbenchTab = useWorkbenchStore((s) => s.setWorkbenchTab);
  const setWorkbenchOpen = useWorkbenchStore((s) => s.setWorkbenchOpen);
  const setReviewScope = useReviewUIStore((s) => s.setReviewScope);
  const focusReviewFile = useReviewUIStore((s) => s.focusReviewFile);
  const openWorkspaceFile = useOpenWorkspaceFile();

  const totalAdditions = useMemo(
    () => rewindUndoState?.restoredFiles?.reduce((acc, f) => acc + (f.additions ?? 0), 0) ?? 0,
    [rewindUndoState],
  );
  const totalDeletions = useMemo(
    () => rewindUndoState?.restoredFiles?.reduce((acc, f) => acc + (f.deletions ?? 0), 0) ?? 0,
    [rewindUndoState],
  );

  const handleOpenReview = (e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (!rewindUndoState?.restoredFiles) return;
    setWorkbenchTab('changes');
    setWorkbenchOpen(true);
    setReviewScope('all_edits', {
      sessionId,
      files: rewindUndoState.restoredFiles.map((file) => file.path),
    });
  };

  const handleOpenFileReview = (filePath: string) => {
    if (!rewindUndoState?.restoredFiles) return;
    setWorkbenchTab('changes');
    setWorkbenchOpen(true);
    focusReviewFile(filePath, {
      sessionId,
      files: rewindUndoState.restoredFiles.map((file) => file.path),
    });
  };

  const [rewindInput, setRewindInput] = useState('');
  const isHistoryChanging =
    (isRewinding || isUndoing || isEditingHistory) &&
    historySnapshotRef.current?.sessionId === sessionId;
  const refreshConversation = useCallback(
    () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: sessionKeys.detail(sessionId) }),
        queryClient.invalidateQueries({ queryKey: sessionKeys.events(sessionId) }),
        queryClient.invalidateQueries({ queryKey: sessionKeys.review(sessionId) }),
        queryClient.invalidateQueries({ queryKey: sessionKeys.execution(sessionId) }),
        queryClient.invalidateQueries({ queryKey: projectKeys.all }),
      ]),
    [queryClient, sessionId],
  );

  const handleRewindRequest = useCallback(
    (eventId: number, mode: RewindMode) => {
      if (historyMutationRef.current) return;
      const eventIndex = events.findIndex((e) => e.id === eventId);
      const messageCount =
        eventIndex === -1
          ? mode === 'fork'
            ? events.length
            : 1
          : mode === 'fork'
            ? eventIndex + 1
            : events.length - eventIndex;

      const event = eventIndex !== -1 ? events[eventIndex] : null;
      const content =
        event && event.type === 'text' && 'content' in event.data
          ? (event.data as { content: string }).content
          : '';
      setConfirmRewind({ eventId, mode, messageCount, input: content });
      setIsRewindDialogOpen(true);
      setRewindError(null);
    },
    [events],
  );

  const handleRewindConfirm = useCallback(async () => {
    if (!confirmRewind || !isRewindDialogOpen) return;
    if (historyMutationRef.current) return;
    historyMutationRef.current = true;
    historySnapshotRef.current = { sessionId, events: visibleEvents ?? events };
    setIsRewinding(true);
    setRewindError(null);
    try {
      const result = await rewindSession(sessionId, confirmRewind.eventId, confirmRewind.mode);
      await refreshConversation();
      if (confirmRewind.mode === 'fork') {
        toast.success('Fork created successfully');
      } else {
        setRewindInput(confirmRewind.input);
        toast.success('Session rewound');
        setIsDiffExpanded(false);
        setRewindUndoState({
          eventId: confirmRewind.eventId,
          mode: confirmRewind.mode,
          restoredFiles: result.restoredFiles,
        });
      }
      setIsRewindDialogOpen(false);
      if (result.forkSessionId) {
        void navigate(`/sessions/${result.forkSessionId}`);
      }
    } catch (err) {
      setRewindError(err instanceof Error ? err.message : 'Rewind failed');
    } finally {
      historyMutationRef.current = false;
      setIsRewinding(false);
    }
  }, [
    confirmRewind,
    isRewindDialogOpen,
    sessionId,
    refreshConversation,
    navigate,
    visibleEvents,
    events,
  ]);

  const handleUndoRewind = useCallback(async () => {
    if (!rewindUndoState || historyMutationRef.current) return;
    historyMutationRef.current = true;
    historySnapshotRef.current = { sessionId, events: visibleEvents ?? events };
    setIsUndoing(true);
    try {
      await undoRewind(sessionId);
      await refreshConversation();
      toast.success('Rewind undone');
      setRewindUndoState(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to undo rewind');
    } finally {
      historyMutationRef.current = false;
      setIsUndoing(false);
    }
  }, [rewindUndoState, sessionId, refreshConversation, visibleEvents, events]);

  const handleEditAndSubmit = useCallback(
    async (eventId: number, newContent: string) => {
      const trimmed = newContent.trim();
      if (!trimmed || historyMutationRef.current) return false;
      const event =
        queryClient
          .getQueryData<typeof events>(sessionKeys.events(sessionId))
          ?.find((item) => item.id === eventId) ?? events.find((item) => item.id === eventId);
      if (
        event?.type === 'text' &&
        event.data.deliveryStatus === 'queued' &&
        event.data.clientMessageId
      )
        return editQueuedMessage(event.data.clientMessageId, trimmed);
      const attachmentIds =
        event?.type === 'text'
          ? (event.data.attachmentIds ??
            event.data.attachments?.map((attachment) => attachment.attachmentId))
          : undefined;
      setRewindUndoState(null);
      historyMutationRef.current = true;
      historySnapshotRef.current = { sessionId, events: visibleEvents ?? events };
      setIsEditingHistory(true);
      try {
        await rewindSession(sessionId, eventId, 'conversation');
        const sent = await handleSend(trimmed, attachmentIds);
        await refreshConversation();
        if (sent === false) return false;
        toast.success('Prompt updated and restarted');
        return true;
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to update prompt');
        return false;
      } finally {
        historyMutationRef.current = false;
        setIsEditingHistory(false);
      }
    },
    [
      sessionId,
      handleSend,
      queryClient,
      events,
      visibleEvents,
      editQueuedMessage,
      refreshConversation,
    ],
  );

  return {
    confirmRewind,
    isRewindDialogOpen,
    setIsRewindDialogOpen,
    isRewinding,
    rewindError,
    historyMutationRef,
    historySnapshotRef,
    rewindUndoState,
    setRewindUndoState,
    isUndoing,
    isDiffExpanded,
    setIsDiffExpanded,
    openWorkspaceFile,
    totalAdditions,
    totalDeletions,
    handleOpenReview,
    handleOpenFileReview,
    rewindInput,
    isHistoryChanging,
    handleRewindRequest,
    handleRewindConfirm,
    handleUndoRewind,
    handleEditAndSubmit,
  };
}
