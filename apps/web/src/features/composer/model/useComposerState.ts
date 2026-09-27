import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import type { SessionWithCapabilities, SessionEventRow } from '@agentctl/shared';
import type { ContextItem } from '@agentctl/api-client';
import { useAttachments } from './useAttachments';
import { useContextAutocomplete } from './useContextAutocomplete';
import { usePromptHistory } from './usePromptHistory';
import { resolveAgentFeatures, type ProviderDiscovery } from '@agentctl/shared';
import { useSettingsOverlayStore } from '@/features/settings';
import { useWorkbenchStore } from '@/features/workbench';
import { useDraftStore } from './useDraftStore';

export interface CommandInfo {
  name: string;
  description?: string;
  input?: { hint?: string };
  category?: string;
}
export type ComposerSend = (
  value: string,
  attachmentIds?: string[],
  files?: File[],
) => void | boolean | Promise<void | boolean>;
interface ComposerOptions {
  onSend: ComposerSend;
  disabled?: boolean;
  sessionId: string;
  projectId?: string;
  draftKey: string;
  sessionData: SessionWithCapabilities | null;
  events: SessionEventRow[];
  providers: ProviderDiscovery[];
  selectedProviderId?: string;
  selectedModelId?: string;
  onProviderSelect?: (providerId: string, modelId?: string) => void;
  initialInput?: string;
  initialFiles?: File[];
  initialContexts?: ContextItem[];
}
export function useComposerState({
  onSend,
  disabled,
  sessionId,
  projectId,
  draftKey,
  sessionData,
  events,
  providers,
  selectedProviderId,
  selectedModelId,
  onProviderSelect,
  initialInput,
  initialFiles = [],
  initialContexts = [],
}: ComposerOptions) {
  const {
    attachments,
    addFiles,
    removeAttachment,
    retryAttachment,
    readyAttachmentIds,
    isAnyUploading,
    pendingFiles,
    clearAll: clearAttachments,
  } = useAttachments(sessionId, initialFiles);

  const installedProviders = useMemo(
    () => providers.filter((p) => p.installState !== 'not_installed'),
    [providers],
  );

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

  const [activeCommandIndex, setActiveCommandIndex] = useState(0);
  const commandRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (initialInput && initialInput.trim().length > 0) {
      queueMicrotask(() => {
        setInput(initialInput);
        requestAnimationFrame(() => {
          const textarea = textareaRef.current;
          if (textarea) {
            textarea.focus();
            textarea.selectionStart = textarea.selectionEnd = textarea.value.length;
          }
        });
      });
    }
  }, [initialInput, setInput]);

  const pendingComposerInsert = useDraftStore((s) => s.pendingComposerInsert);
  const clearPendingComposerInsert = useDraftStore((s) => s.clearPendingComposerInsert);
  const pendingContextItem = useDraftStore((s) => s.pendingContextItem);
  const clearPendingContextItem = useDraftStore((s) => s.clearPendingContextItem);

  useEffect(() => {
    if (!pendingComposerInsert) return;

    setInput((prev) => {
      const trimmed = prev.trimEnd();
      if (trimmed.length === 0) return pendingComposerInsert;
      const sep = pendingComposerInsert.includes('\n') ? '\n\n' : ' ';
      return `${trimmed}${sep}${pendingComposerInsert}`;
    });

    clearPendingComposerInsert();

    requestAnimationFrame(() => {
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
        requestAnimationFrame(() => {
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
  }, []);

  const isRunning = sessionData?.session.status === 'running';

  // Read authoritative slash commands advertised over ACP by the agent, merged with client shortcuts
  const commands = useMemo<CommandInfo[]>(() => {
    const acpList = sessionData?.session.availableCommands ?? [];
    const agentCommands: CommandInfo[] = acpList.map((cmd) => ({
      name: cmd.name,
      description: cmd.description,
      input: cmd.input ? { hint: cmd.input.hint } : undefined,
      category: 'Agent',
    }));

    const localShortcuts: CommandInfo[] = [
      { name: 'terminal', description: 'Switch workbench view to Terminal', category: 'View' },
      { name: 'mcp', description: 'Open MCP Server Tools & Status modal', category: 'System' },
    ];

    const seen = new Set<string>();
    const merged: CommandInfo[] = [];

    for (const cmd of [...agentCommands, ...localShortcuts]) {
      if (!seen.has(cmd.name)) {
        seen.add(cmd.name);
        merged.push(cmd);
      }
    }

    return merged;
  }, [sessionData?.session.availableCommands]);

  const promptHistory = usePromptHistory(events);

  const contextAutocomplete = useContextAutocomplete({
    sessionId,
    projectId,
    initialContexts,
    input,
    setInput,
    textareaRef,
  });

  const { addAttachedContext } = contextAutocomplete;

  useEffect(() => {
    if (!pendingContextItem) return;

    addAttachedContext(pendingContextItem);
    clearPendingContextItem();

    requestAnimationFrame(() => {
      const textarea = textareaRef.current;
      if (textarea) {
        textarea.focus();
        textarea.selectionStart = textarea.selectionEnd = textarea.value.length;
      }
    });
  }, [pendingContextItem, clearPendingContextItem, addAttachedContext]);

  const handleInputChange = useCallback(
    (val: string) => {
      setInput(val);
      setActiveCommandIndex(0);
      promptHistory.resetNavigation();
    },
    [promptHistory],
  );

  const handleHistoryUp = useCallback(() => {
    const textarea = textareaRef.current;
    const isAtStart =
      !input || (textarea ? textarea.selectionStart === 0 && textarea.selectionEnd === 0 : true);
    const prev = promptHistory.navigateUp(input, isAtStart);
    if (prev !== null) {
      setInput(prev);
      requestAnimationFrame(() => {
        if (textarea) {
          textarea.selectionStart = textarea.selectionEnd = prev.length;
        }
      });
      return true;
    }
    return false;
  }, [input, promptHistory]);

  const handleHistoryDown = useCallback(() => {
    const textarea = textareaRef.current;
    const next = promptHistory.navigateDown(input);
    if (next !== null) {
      setInput(next);
      requestAnimationFrame(() => {
        if (textarea) {
          textarea.selectionStart = textarea.selectionEnd = next.length;
        }
      });
      return true;
    }
    return false;
  }, [input, promptHistory]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = `${String(Math.min(textarea.scrollHeight, 240))}px`;
  }, [input]);

  const isSlashCommand = input.startsWith('/');

  const filteredCommands = useMemo(() => {
    if (!isSlashCommand) return [];
    const query = input.slice(1).toLowerCase().trim();
    if (!query) return commands;
    return commands.filter((c) => c.name.toLowerCase().includes(query));
  }, [isSlashCommand, input, commands]);

  const showSlashMenu = isSlashCommand && filteredCommands.length > 0 && !input.includes(' ');

  const matchingCommand = useMemo<CommandInfo | undefined>(() => {
    if (!isSlashCommand) return undefined;
    const parts = input.slice(1).split(' ');
    const cmdName = parts[0].toLowerCase();
    return commands.find((cmd) => cmd.name.toLowerCase() === cmdName);
  }, [isSlashCommand, input, commands]);

  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [isFocused, setIsFocused] = useState(false);

  const effectiveProviderId =
    selectedProviderId ?? sessionData?.session.selectedProvider ?? undefined;
  const effectiveModelId = selectedModelId ?? sessionData?.session.selectedModel ?? undefined;

  const activeProvider = useMemo<ProviderDiscovery | undefined>(() => {
    if (!effectiveProviderId) return installedProviders[0];
    return installedProviders.find((p) => p.id === effectiveProviderId) ?? installedProviders[0];
  }, [installedProviders, effectiveProviderId]);

  const resolvedId = activeProvider?.id ?? effectiveProviderId ?? '';
  const supportsImageAttachments = resolveAgentFeatures(activeProvider).prompts.image;

  const selectedProviderLabel = useMemo(() => {
    if (!activeProvider) return effectiveProviderId ?? 'Select Agent';
    const providerName = activeProvider.label;
    const modelLabel = effectiveModelId ?? undefined;
    return modelLabel ? `${providerName} · ${modelLabel}` : providerName;
  }, [activeProvider, effectiveProviderId, effectiveModelId]);

  const submittingRef = useRef(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const handleSubmit = useCallback(async () => {
    const trimmed = input.trim();
    const hasContext = contextAutocomplete.attachedContexts.length > 0;
    if (!trimmed && readyAttachmentIds.length === 0 && pendingFiles.length === 0 && !hasContext)
      return;
    if (disabled || isAnyUploading || submittingRef.current) return;

    // Check for purely functional view actions (e.g. /timeline, /terminal, /mcp)
    if (trimmed.startsWith('/') && !trimmed.includes(' ')) {
      const cmdName = trimmed.slice(1).toLowerCase();
      if (cmdName === 'terminal' || cmdName === 'status' || cmdName === 'changes') {
        useWorkbenchStore.getState().setWorkbenchTab(cmdName);
        setInput('');
        return;
      }
      if (cmdName === 'mcp') {
        useSettingsOverlayStore.getState().openMcpSettings();
        setInput('');
        return;
      }
    }

    submittingRef.current = true;
    setIsSubmitting(true);
    try {
      let finalPrompt = trimmed;

      if (hasContext) {
        const fileContexts = contextAutocomplete.attachedContexts.filter(
          (c) => c.type === 'file' || c.type === 'folder',
        );
        const dynamicContexts = contextAutocomplete.attachedContexts.filter(
          (c) => c.type === 'git',
        );

        // Resolve dynamic git context (like git:diff) if attached
        if (dynamicContexts.length > 0) {
          const resolved = await contextAutocomplete.resolveAttachedContexts();
          if (resolved?.formattedContent) {
            finalPrompt = finalPrompt
              ? `${finalPrompt}\n\n${resolved.formattedContent}`
              : resolved.formattedContent;
          }
        }

        // Attach file / folder references cleanly (Reference-Only paradigm)
        if (fileContexts.length > 0) {
          const mentionHeader = fileContexts.map((c) => `@${c.value}`).join(' ');
          if (!finalPrompt) {
            finalPrompt = `Please review and explain ${mentionHeader}`;
          } else {
            finalPrompt = `${mentionHeader}\n\n${finalPrompt}`;
          }
        }
      }

      const accepted = await onSend(
        finalPrompt,
        readyAttachmentIds.length > 0 ? readyAttachmentIds : undefined,
        pendingFiles,
      );
      if (accepted === false) return;
      if (finalPrompt) promptHistory.recordPrompt(finalPrompt);
      contextAutocomplete.clearAttachedContexts();
      clearAttachments();
      setInput('');
    } finally {
      submittingRef.current = false;
      setIsSubmitting(false);
    }
  }, [
    input,
    contextAutocomplete,
    readyAttachmentIds,
    pendingFiles,
    clearAttachments,
    disabled,
    isAnyUploading,
    onSend,
    promptHistory,
    setInput,
  ]);

  const handleProviderSelect = useCallback(
    (providerId: string, modelId?: string) => {
      if (onProviderSelect) {
        onProviderSelect(providerId, modelId);
      }
      setIsPickerOpen(false);
    },
    [onProviderSelect],
  );

  const handleAttachClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files && e.target.files.length > 0) {
        const files = Array.from(e.target.files);
        const imageFiles = files.filter((f) => f.type.startsWith('image/'));
        const otherFiles = files.filter((f) => !f.type.startsWith('image/'));

        if (supportsImageAttachments && imageFiles.length > 0) {
          addFiles(imageFiles);
        } else {
          // Images can't be uploaded for this agent — attach them as file context instead.
          for (const file of imageFiles) {
            const filePath = (file as { path?: string }).path || file.name;
            contextAutocomplete.selectItem({
              id: `file:${filePath}`,
              type: 'file',
              title: file.name,
              subtitle: filePath,
              value: filePath,
            });
          }
        }

        for (const file of otherFiles) {
          const filePath = (file as { path?: string }).path || file.name;
          contextAutocomplete.selectItem({
            id: `file:${filePath}`,
            type: 'file',
            title: file.name,
            subtitle: filePath,
            value: filePath,
          });
        }
      }
      e.target.value = '';
    },
    [addFiles, contextAutocomplete, supportsImageAttachments],
  );

  const handlePaste = useCallback(
    (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
      const items = Array.from(e.clipboardData.items);
      const imageItems = items.filter((item) => item.type.startsWith('image/'));
      if (supportsImageAttachments && imageItems.length > 0) {
        e.preventDefault();
        const files = imageItems
          .map((item) => item.getAsFile())
          .filter((f): f is File => f !== null);
        addFiles(files);
      }
    },
    [addFiles, supportsImageAttachments],
  );

  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const dragCounter = useRef(0);

  const handleDragEnter = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const types = Array.from(e.dataTransfer?.types || []);
    if (types.includes('Files') || types.includes('text/uri-list')) {
      dragCounter.current += 1;
      if (dragCounter.current === 1) {
        setIsDraggingOver(true);
      }
    }
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    dragCounter.current = Math.max(0, dragCounter.current - 1);
    if (dragCounter.current === 0) {
      setIsDraggingOver(false);
    }
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      dragCounter.current = 0;
      setIsDraggingOver(false);
      const items = Array.from(e.dataTransfer.items || []);
      if (items.length > 0) {
        const imageFiles: File[] = [];
        for (const item of items) {
          if (item.kind !== 'file') continue;
          const entry = item.webkitGetAsEntry?.();
          const file = item.getAsFile();
          if (!file) continue;

          if (file.type.startsWith('image/')) {
            imageFiles.push(file);
          } else {
            const isDirectory = entry?.isDirectory ?? false;
            const filePath = (file as { path?: string }).path || file.name;
            const displayName = isDirectory
              ? file.name.endsWith('/')
                ? file.name
                : `${file.name}/`
              : file.name;

            contextAutocomplete.selectItem({
              id: isDirectory ? `folder:${filePath}` : `file:${filePath}`,
              type: isDirectory ? 'folder' : 'file',
              title: displayName,
              subtitle: filePath,
              value: filePath,
            });
          }
        }
        if (supportsImageAttachments && imageFiles.length > 0) {
          addFiles(imageFiles);
        }
      } else {
        const files = Array.from(e.dataTransfer.files);
        const imageFiles = files.filter((f) => f.type.startsWith('image/'));
        const otherFiles = files.filter((f) => !f.type.startsWith('image/'));

        if (supportsImageAttachments && imageFiles.length > 0) {
          addFiles(imageFiles);
        }

        for (const file of otherFiles) {
          const filePath = (file as { path?: string }).path || file.name;
          contextAutocomplete.selectItem({
            id: `file:${filePath}`,
            type: 'file',
            title: file.name,
            subtitle: filePath,
            value: filePath,
          });
        }
      }
    },
    [addFiles, contextAutocomplete, supportsImageAttachments],
  );

  const canSend =
    !disabled &&
    !isSubmitting &&
    !isAnyUploading &&
    (input.trim().length > 0 ||
      readyAttachmentIds.length > 0 ||
      pendingFiles.length > 0 ||
      contextAutocomplete.attachedContexts.length > 0);

  const handleSelectCommand = useCallback(
    (cmd: CommandInfo) => {
      const completedText = '/' + cmd.name + ' ';
      handleInputChange(completedText);
      textareaRef.current?.focus();
    },
    [handleInputChange],
  );

  return {
    sessionId,
    sessionData,
    isSubmitting,
    providers: installedProviders,
    input,
    setInput,
    handleInputChange,
    activeCommandIndex,
    setActiveCommandIndex,
    isRunning,
    commandRefs,
    showSlashMenu,
    filteredCommands,
    matchingCommand,
    isPickerOpen,
    setIsPickerOpen,
    isFocused,
    setIsFocused,
    textareaRef,
    fileInputRef,
    attachments,
    removeAttachment,
    retryAttachment,
    readyAttachmentIds,
    isAnyUploading,
    resolvedId,
    activeProvider,
    selectedProviderLabel,
    handleSubmit,
    handleProviderSelect,
    handleAttachClick,
    supportsImageAttachments,
    handleFileInputChange,
    handlePaste,
    handleDrop,
    isDraggingOver,
    handleDragEnter,
    handleDragLeave,
    canSend,
    handleSelectCommand,
    contextAutocomplete,
    handleHistoryUp,
    handleHistoryDown,
  };
}
