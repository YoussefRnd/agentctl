import { useRef, useState, useEffect, useCallback, type RefObject } from 'react';
import { useDraftStore } from './useDraftStore';
import { useFrameScheduler } from '@/shared/hooks/useFrameScheduler';

/** Owns persisted input, pending text insertion and edit-prompt listener cleanup. */
export function useComposerDraft({
  draftKey,
  initialInput,
  textareaRef,
  setActiveCommandIndex,
}: {
  draftKey: string;
  initialInput?: string;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  setActiveCommandIndex: (index: number) => void;
}) {
  const scheduleFrame = useFrameScheduler(draftKey);
  const prevSessionIdRef = useRef(draftKey);
  const setSessionDraft = useDraftStore((s) => s.setSessionDraft);
  const clearSessionDraft = useDraftStore((s) => s.clearSessionDraft);

  const [input, setInputState] = useState(() => {
    return (draftKey ? useDraftStore.getState().sessionDrafts[draftKey] : '') || initialInput || '';
  });

  useEffect(() => {
    if (prevSessionIdRef.current !== draftKey) {
      prevSessionIdRef.current = draftKey;
      const currentDraft =
        (draftKey ? useDraftStore.getState().sessionDrafts[draftKey] : '') || initialInput || '';
      setInputState(currentDraft);
    }
  }, [draftKey, initialInput]);

  const setInput = useCallback(
    (value: string | ((prev: string) => string)) => {
      setInputState((prev) => {
        const next = typeof value === 'function' ? value(prev) : value;
        if (draftKey) {
          if (next.trim().length > 0) {
            setSessionDraft(draftKey, next);
          } else {
            clearSessionDraft(draftKey);
          }
        }
        return next;
      });
    },
    [draftKey, setSessionDraft, clearSessionDraft],
  );

  useEffect(() => {
    let cancelled = false;
    if (initialInput && initialInput.trim().length > 0) {
      queueMicrotask(() => {
        if (cancelled) return;
        setInput(initialInput);
        scheduleFrame(() => {
          const textarea = textareaRef.current;
          if (textarea) {
            textarea.focus();
            textarea.selectionStart = textarea.selectionEnd = textarea.value.length;
          }
        });
      });
    }
    return () => {
      cancelled = true;
    };
  }, [initialInput, setInput, scheduleFrame]);

  const pendingComposerInsert = useDraftStore((s) => s.pendingComposerInsert);
  const clearPendingComposerInsert = useDraftStore((s) => s.clearPendingComposerInsert);

  useEffect(() => {
    if (!pendingComposerInsert) return;

    setInput((prev) => {
      const trimmed = prev.trimEnd();
      if (trimmed.length === 0) return pendingComposerInsert;
      const sep = pendingComposerInsert.includes('\n') ? '\n\n' : ' ';
      return `${trimmed}${sep}${pendingComposerInsert}`;
    });

    clearPendingComposerInsert();

    scheduleFrame(() => {
      const textarea = textareaRef.current;
      if (textarea) {
        textarea.focus();
        textarea.selectionStart = textarea.selectionEnd = textarea.value.length;
      }
    });
  }, [pendingComposerInsert, clearPendingComposerInsert, setInput]);

  useEffect(() => {
    const handleEditPrompt = (e: Event) => {
      const customEvent = e as CustomEvent<string>;
      if (typeof customEvent.detail === 'string') {
        setInput(customEvent.detail);
        setActiveCommandIndex(0);
        scheduleFrame(() => {
          const textarea = textareaRef.current;
          if (textarea) {
            textarea.focus();
            textarea.selectionStart = textarea.selectionEnd = textarea.value.length;
            textarea.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
        });
      }
    };
    window.addEventListener('agentctl:edit-prompt', handleEditPrompt);
    return () => {
      window.removeEventListener('agentctl:edit-prompt', handleEditPrompt);
    };
  }, [setInput, setActiveCommandIndex, scheduleFrame]);

  return { input, setInput };
}
