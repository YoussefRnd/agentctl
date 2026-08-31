import { useState, useEffect, useRef, useCallback } from 'react';
import type { ACPEventRow } from '@agentctl/shared';

const STORAGE_KEY = 'agentctl:prompt_history';
const MAX_HISTORY = 50;

function getStoredHistory(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string')
      : [];
  } catch {
    return [];
  }
}

function saveStoredHistory(history: string[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(history.slice(-MAX_HISTORY)));
  } catch {
    // Ignore storage quota or disabled errors
  }
}

export function usePromptHistory(sessionEvents?: ACPEventRow[]) {
  const [history, setHistory] = useState<string[]>(() => getStoredHistory());
  const historyIndexRef = useRef<number>(-1);
  const draftRef = useRef<string>('');

  // Merge session events into history list
  useEffect(() => {
    if (!sessionEvents || sessionEvents.length === 0) return;

    const sessionUserPrompts = sessionEvents
      .filter((e) => e.type === 'text' && (e.data as { role?: string })?.role === 'user')
      .map((e) => (e.data as { content?: string })?.content)
      .filter(
        (content): content is string => typeof content === 'string' && content.trim().length > 0,
      );

    if (sessionUserPrompts.length === 0) return;

    setHistory((prev) => {
      const merged = [...prev];
      for (const prompt of sessionUserPrompts) {
        const last = merged[merged.length - 1];
        if (last !== prompt) {
          merged.push(prompt);
        }
      }
      return merged.slice(-MAX_HISTORY);
    });
  }, [sessionEvents]);

  const recordPrompt = useCallback((prompt: string) => {
    const trimmed = prompt.trim();
    if (!trimmed) return;

    setHistory((prev) => {
      const next = prev.filter((p) => p !== trimmed);
      next.push(trimmed);
      const capped = next.slice(-MAX_HISTORY);
      saveStoredHistory(capped);
      return capped;
    });

    historyIndexRef.current = -1;
    draftRef.current = '';
  }, []);

  const navigateUp = useCallback(
    (currentInput: string, isAtStart: boolean): string | null => {
      if (!isAtStart || history.length === 0) return null;

      if (historyIndexRef.current === -1) {
        draftRef.current = currentInput;
        historyIndexRef.current = history.length - 1;
      } else if (historyIndexRef.current > 0) {
        historyIndexRef.current -= 1;
      } else {
        // Already at oldest entry
        return history[0];
      }

      return history[historyIndexRef.current];
    },
    [history],
  );

  const navigateDown = useCallback(
    (currentInput: string): string | null => {
      if (historyIndexRef.current === -1) return null;

      if (historyIndexRef.current < history.length - 1) {
        historyIndexRef.current += 1;
        return history[historyIndexRef.current];
      }

      // Reached bottom, restore draft
      const restoredDraft = draftRef.current;
      historyIndexRef.current = -1;
      draftRef.current = '';
      return restoredDraft;
    },
    [history],
  );

  const resetNavigation = useCallback(() => {
    historyIndexRef.current = -1;
  }, []);

  return {
    history,
    recordPrompt,
    navigateUp,
    navigateDown,
    resetNavigation,
    isNavigatingHistory: historyIndexRef.current !== -1,
  };
}
