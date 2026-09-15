import { useState, useEffect, useCallback, useRef } from 'react';
import {
  searchContext,
  resolveContext,
  type ContextItem,
  type ContextItemType,
  type ResolvedContextResult,
} from '@agentctl/api-client';

export interface UseContextAutocompleteProps {
  sessionId: string;
  input: string;
  setInput: (value: string) => void;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
}

export interface UseContextAutocompleteReturn {
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
  items: ContextItem[];
  isLoading: boolean;
  activeIndex: number;
  setActiveIndex: (index: number) => void;
  filterType: 'all' | ContextItemType;
  setFilterType: (type: 'all' | ContextItemType) => void;
  attachedContexts: ContextItem[];
  selectItem: (item: ContextItem) => void;
  addAttachedContext: (item: ContextItem) => void;
  removeAttachedContext: (id: string) => void;
  clearAttachedContexts: () => void;
  resolveAttachedContexts: () => Promise<ResolvedContextResult | null>;
  handleKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => boolean; // returns true if handled
}

function getAtMatchRange(input: string, textarea: HTMLTextAreaElement | null) {
  const cursorPos = textarea ? textarea.selectionStart || input.length : input.length;
  const textBeforeCursor = input.slice(0, cursorPos);
  const lastAtIndex = textBeforeCursor.lastIndexOf('@');

  if (lastAtIndex !== -1) {
    const charBeforeAt = lastAtIndex > 0 ? textBeforeCursor[lastAtIndex - 1] : ' ';
    if (charBeforeAt === ' ' || charBeforeAt === '\n' || lastAtIndex === 0) {
      const queryText = textBeforeCursor.slice(lastAtIndex + 1);
      if (!queryText.includes(' ') && !queryText.includes('\n')) {
        return {
          start: lastAtIndex,
          end: cursorPos,
          query: queryText,
        };
      }
    }
  }
  return null;
}

export function useContextAutocomplete({
  sessionId,
  input,
  setInput,
  textareaRef,
}: UseContextAutocompleteProps): UseContextAutocompleteReturn {
  const [isDismissed, setIsDismissed] = useState(false);
  const [items, setItems] = useState<ContextItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [filterType, setFilterType] = useState<'all' | ContextItemType>('all');
  const [attachedContexts, setAttachedContexts] = useState<ContextItem[]>([]);

  const atMatchRange = getAtMatchRange(input, textareaRef.current);
  const isOpen = Boolean(sessionId && atMatchRange && !isDismissed);

  const setIsOpen = useCallback((open: boolean) => {
    setIsDismissed(!open);
  }, []);

  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Fetch search suggestions when open
  useEffect(() => {
    if (!isOpen || !sessionId) return;

    const query = atMatchRange?.query ?? '';

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    debounceTimerRef.current = setTimeout(async () => {
      setIsLoading(true);
      try {
        const results = await searchContext(sessionId, query, filterType);
        setItems(results);
        setActiveIndex(0);
      } catch {
        setItems([]);
      } finally {
        setIsLoading(false);
      }
    }, 40);

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [isOpen, atMatchRange?.query, filterType, sessionId]);

  const selectItem = useCallback(
    (item: ContextItem) => {
      // 1. Add to attached context list if not already attached
      setAttachedContexts((prev) => {
        if (prev.some((c) => c.id === item.id)) return prev;
        return [...prev, item];
      });

      // 2. Remove the '@query' from the input text
      if (atMatchRange) {
        const before = input.slice(0, atMatchRange.start);
        const after = input.slice(atMatchRange.end);
        const nextInput = `${before}${after}`;
        setInput(nextInput);

        requestAnimationFrame(() => {
          if (textareaRef.current) {
            textareaRef.current.focus();
            textareaRef.current.selectionStart = textareaRef.current.selectionEnd =
              atMatchRange.start;
          }
        });
      }

      setIsOpen(false);
    },
    [atMatchRange, input, setIsOpen, setInput, textareaRef],
  );

  const addAttachedContext = useCallback((item: ContextItem) => {
    setAttachedContexts((prev) => {
      if (prev.some((c) => c.id === item.id)) return prev;
      return [...prev, item];
    });
  }, []);

  const removeAttachedContext = useCallback((id: string) => {
    setAttachedContexts((prev) => prev.filter((c) => c.id !== id));
  }, []);

  const clearAttachedContexts = useCallback(() => {
    setAttachedContexts([]);
  }, []);

  const resolveAttachedContexts = useCallback(async (): Promise<ResolvedContextResult | null> => {
    if (attachedContexts.length === 0 || !sessionId) return null;

    try {
      const itemsToResolve = attachedContexts.map((c) => ({
        type: c.type,
        value: c.value,
        path: c.type === 'file' || c.type === 'folder' ? c.value : undefined,
        target: c.type === 'git' ? c.value : undefined,
      }));

      const resolved = await resolveContext(sessionId, itemsToResolve);
      return resolved;
    } catch {
      return null;
    }
  }, [attachedContexts, sessionId]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>): boolean => {
      if (!isOpen || items.length === 0) return false;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIndex((prev) => (prev + 1) % items.length);
        return true;
      }

      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIndex((prev) => (prev - 1 + items.length) % items.length);
        return true;
      }

      if (e.key === 'Enter' || e.key === 'Tab') {
        if (!e.shiftKey) {
          e.preventDefault();
          const selected = items[activeIndex];
          if (selected) {
            selectItem(selected);
          }
          return true;
        }
      }

      if (e.key === 'Escape') {
        e.preventDefault();
        setIsOpen(false);
        return true;
      }

      return false;
    },
    [isOpen, items, activeIndex, selectItem, setIsOpen],
  );

  return {
    isOpen,
    setIsOpen,
    items,
    isLoading,
    activeIndex,
    setActiveIndex,
    filterType,
    setFilterType,
    attachedContexts,
    selectItem,
    addAttachedContext,
    removeAttachedContext,
    clearAttachedContexts,
    resolveAttachedContexts,
    handleKeyDown,
  };
}
