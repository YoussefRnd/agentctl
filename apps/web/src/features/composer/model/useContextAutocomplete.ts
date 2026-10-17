import { useFrameScheduler } from '@/shared/hooks/useFrameScheduler';
import { useState, useEffect, useCallback, useRef, useId } from 'react';
import {
  searchContext,
  resolveContext,
  type ContextItem,
  type ContextItemType,
  type ResolvedContextResult,
} from '@agentctl/api-client';

export interface UseContextAutocompleteProps {
  sessionId: string;
  projectId?: string;
  initialContexts?: ContextItem[];
  input: string;
  setInput: (value: string) => void;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
}

export interface UseContextAutocompleteReturn {
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
  items: ContextItem[];
  isLoading: boolean;
  searchError: boolean;
  query: string;
  listboxId: string;
  syncSelection: () => void;
  activeIndex: number;
  setActiveIndex: (index: number) => void;
  filterType: 'all' | ContextItemType;
  setFilterType: (type: 'all' | ContextItemType) => void;
  attachedContexts: ContextItem[];
  selectItem: (item: ContextItem) => void;
  addAttachedContext: (item: ContextItem) => void;
  removeAttachedContext: (id: string) => void;
  clearAttachedContexts: () => void;
  resolveAttachedContexts: (contexts?: ContextItem[]) => Promise<ResolvedContextResult | null>;
  handleKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => boolean; // returns true if handled
}

function getAtMatchRange(input: string, cursorPos: number) {
  const textBeforeCursor = input.slice(0, cursorPos);
  const lastAtIndex = textBeforeCursor.lastIndexOf('@');

  if (lastAtIndex !== -1) {
    const charBeforeAt = lastAtIndex > 0 ? textBeforeCursor[lastAtIndex - 1] : ' ';
    if (/\s/.test(charBeforeAt) || lastAtIndex === 0) {
      const queryText = textBeforeCursor.slice(lastAtIndex + 1);
      if (!/\s/.test(queryText)) {
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
  projectId,
  initialContexts = [],
  input,
  setInput,
  textareaRef,
}: UseContextAutocompleteProps): UseContextAutocompleteReturn {
  const scheduleFrame = useFrameScheduler(sessionId || projectId);
  const listboxId = useId();
  const [dismissedMatch, setDismissedMatch] = useState<string | null>(null);
  const [selection, setSelection] = useState<{ input: string; start: number; end: number } | null>(
    null,
  );
  const [search, setSearch] = useState<{
    key: string;
    items: ContextItem[];
    loading: boolean;
    error: boolean;
  }>({ key: '', items: [], loading: false, error: false });
  const [activeIndex, setActiveIndex] = useState(0);
  const [filterType, setFilterType] = useState<'all' | ContextItemType>('all');
  const [attachedContexts, setAttachedContexts] = useState<ContextItem[]>(initialContexts);
  const searchCache = useRef(new Map<string, { items: ContextItem[]; cachedAt: number }>());

  const syncSelection = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const next = {
      input: textarea.value,
      start: textarea.selectionStart,
      end: textarea.selectionEnd,
    };
    setSelection((prev) =>
      prev?.input === next.input && prev.start === next.start && prev.end === next.end
        ? prev
        : next,
    );
  }, [textareaRef]);

  const cursor =
    selection?.input === input ? selection : { start: input.length, end: input.length };
  const atMatchRange = cursor.start === cursor.end ? getAtMatchRange(input, cursor.start) : null;
  const contextId = sessionId || projectId || '';
  const scope = projectId && !sessionId ? 'projects' : 'sessions';
  const matchKey = atMatchRange ? JSON.stringify([scope, contextId, input, cursor.start]) : null;
  const isOpen = Boolean(contextId && matchKey && matchKey !== dismissedMatch);
  const query = atMatchRange?.query ?? '';
  const searchKey = JSON.stringify([scope, contextId, query.toLowerCase(), filterType]);
  // Hide old-query results immediately, including during the debounce window.
  const items = search.key === searchKey ? search.items : [];
  const isLoading = isOpen && (search.key !== searchKey || search.loading);
  const searchError = isOpen && search.key === searchKey && search.error;

  const setIsOpen = useCallback(
    (open: boolean) => {
      setDismissedMatch(open ? null : matchKey);
    },
    [matchKey],
  );

  useEffect(() => {
    if (!matchKey) setDismissedMatch(null);
  }, [matchKey]);

  useEffect(() => {
    if (!isOpen || !contextId) return;
    setActiveIndex(0);
    const cached = searchCache.current.get(searchKey);
    if (cached && Date.now() - cached.cachedAt < 5000) {
      setSearch({ key: searchKey, items: cached.items, loading: false, error: false });
      return;
    }

    let current = true;
    const controller = new AbortController();
    setSearch({ key: searchKey, items: [], loading: true, error: false });
    const timer = setTimeout(
      async () => {
        try {
          const results = await searchContext(
            contextId,
            query,
            filterType,
            scope,
            controller.signal,
          );
          if (!current) return;
          // Bound this per-composer cache and refresh it after five seconds.
          if (searchCache.current.size >= 40) {
            const oldest = searchCache.current.keys().next().value;
            if (oldest !== undefined) searchCache.current.delete(oldest);
          }
          searchCache.current.set(searchKey, { items: results, cachedAt: Date.now() });
          setSearch({ key: searchKey, items: results, loading: false, error: false });
        } catch {
          if (current) setSearch({ key: searchKey, items: [], loading: false, error: true });
        }
      },
      query ? 80 : 0,
    );

    return () => {
      current = false;
      clearTimeout(timer);
      controller.abort();
    };
  }, [isOpen, searchKey, contextId, query, filterType, scope]);

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

        scheduleFrame(() => {
          if (textareaRef.current) {
            textareaRef.current.focus();
            textareaRef.current.selectionStart = textareaRef.current.selectionEnd =
              atMatchRange.start;
            syncSelection();
          }
        });
      }

      setIsOpen(false);
    },
    [atMatchRange, input, setIsOpen, setInput, textareaRef, syncSelection],
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

  const resolveAttachedContexts = useCallback(
    async (contexts = attachedContexts): Promise<ResolvedContextResult | null> => {
      if (contexts.length === 0 || !contextId) return null;

      try {
        const itemsToResolve = contexts.map((c) => ({
          type: c.type,
          value: c.value,
          path: c.type === 'file' || c.type === 'folder' ? c.value : undefined,
          target: c.type === 'git' ? c.value : undefined,
        }));

        const resolved =
          projectId && !sessionId
            ? await resolveContext(contextId, itemsToResolve, 'projects')
            : await resolveContext(contextId, itemsToResolve);
        return resolved;
      } catch {
        return null;
      }
    },
    [attachedContexts, contextId, projectId, sessionId],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>): boolean => {
      if (!isOpen || e.nativeEvent.isComposing) return false;

      if (e.key === 'Escape') {
        e.preventDefault();
        setIsOpen(false);
        return true;
      }

      // Enter belongs to the picker while a search is pending. Never send the
      // message accidentally or attach a result from the previous query.
      if (isLoading && (e.key === 'Enter' || e.key === 'Tab') && !e.shiftKey) {
        e.preventDefault();
        return true;
      }
      if (items.length === 0) return false;

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

      return false;
    },
    [isOpen, isLoading, items, activeIndex, selectItem, setIsOpen],
  );

  return {
    isOpen,
    setIsOpen,
    items,
    isLoading,
    searchError,
    query,
    listboxId,
    syncSelection,
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
