import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useSession, useSessionStream } from '../../../contexts/SessionContext';
import { useProviders } from '../../../hooks/useProviders';
import { useAttachments } from '../../../hooks/useAttachments';
import { useContextAutocomplete } from '../../../hooks/useContextAutocomplete';
import { useSessionActions } from '../../../hooks/useSessionActions';
import { usePromptHistory } from '../hooks/usePromptHistory';
import type { ProviderDiscovery } from '@agentctl/shared';
import { useUIStore } from '@/shared';

export interface CommandInfo {
  name: string;
  description?: string;
  input?: { hint?: string };
  category?: string;
}

export function useCommandBarState(
  onSend: (value: string, attachmentIds?: string[]) => void,
  disabled?: boolean,
  selectedProviderId?: string,
  selectedModelId?: string,
  onProviderSelect?: (providerId: string, modelId?: string) => void,
  initialInput?: string,
) {
  const {
    sessionId,
    sessionData,
    branches,
    switchBranch,
    isSwitchingBranch,
    switchMode,
    isSwitchingMode,
    setApprovalMode,
    isUpdatingApprovalMode,
    setAgentPersona,
    isUpdatingAgentPersona,
    setSessionConfigOption,
    isUpdatingConfigOption,
    isLoadingSession,
  } = useSession();

  const { handleCancel } = useSessionActions();
  const { providers, isLoadingProviders } = useProviders(sessionId);

  const {
    attachments,
    addFiles,
    removeAttachment,
    retryAttachment,
    readyAttachmentIds,
    isAnyUploading,
  } = useAttachments(sessionId);

  const installedProviders = useMemo(
    () => providers.filter((p) => p.installState !== 'not_installed'),
    [providers],
  );

  const prevSessionIdRef = useRef(sessionId);
  const setSessionDraft = useUIStore((s) => s.setSessionDraft);
  const clearSessionDraft = useUIStore((s) => s.clearSessionDraft);

  const [input, setInputState] = useState(() => {
    return (sessionId ? useUIStore.getState().sessionDrafts[sessionId] : '') || initialInput || '';
  });

  useEffect(() => {
    if (prevSessionIdRef.current !== sessionId) {
      prevSessionIdRef.current = sessionId;
      const currentDraft =
        (sessionId ? useUIStore.getState().sessionDrafts[sessionId] : '') || initialInput || '';
      setInputState(currentDraft);
    }
  }, [sessionId, initialInput]);

  const setInput = useCallback(
    (value: string | ((prev: string) => string)) => {
      setInputState((prev) => {
        const next = typeof value === 'function' ? value(prev) : value;
        if (sessionId) {
          if (next.trim().length > 0) {
            setSessionDraft(sessionId, next);
          } else {
            clearSessionDraft(sessionId);
          }
        }
        return next;
      });
    },
    [sessionId, setSessionDraft, clearSessionDraft],
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

  const pendingComposerInsert = useUIStore((s) => s.pendingComposerInsert);
  const clearPendingComposerInsert = useUIStore((s) => s.clearPendingComposerInsert);
  const pendingContextItem = useUIStore((s) => s.pendingContextItem);
  const clearPendingContextItem = useUIStore((s) => s.clearPendingContextItem);

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

  const { events } = useSessionStream();
  const promptHistory = usePromptHistory(events);

  const contextAutocomplete = useContextAutocomplete({
    sessionId,
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

  const activeProvider = useMemo<ProviderDiscovery | undefined>(() => {
    if (!selectedProviderId) return installedProviders[0];
    return installedProviders.find((p) => p.id === selectedProviderId) ?? installedProviders[0];
  }, [installedProviders, selectedProviderId]);

  const resolvedId = activeProvider?.id ?? selectedProviderId ?? '';

  const selectedProviderLabel = useMemo(() => {
    if (!activeProvider) return selectedProviderId ?? 'Select Agent';
    const providerName = activeProvider.label;
    const modelLabel = selectedModelId ?? undefined;
    return modelLabel ? `${providerName} · ${modelLabel}` : providerName;
  }, [activeProvider, selectedProviderId, selectedModelId]);

  const handleSubmit = useCallback(async () => {
    const trimmed = input.trim();
    const hasContext = contextAutocomplete.attachedContexts.length > 0;
    if (!trimmed && readyAttachmentIds.length === 0 && !hasContext) return;
    if (disabled || isAnyUploading) return;

    // Check for purely functional view actions (e.g. /timeline, /terminal, /mcp)
    if (trimmed.startsWith('/') && !trimmed.includes(' ')) {
      const cmdName = trimmed.slice(1).toLowerCase();
      if (cmdName === 'terminal' || cmdName === 'status' || cmdName === 'changes') {
        useUIStore.getState().setWorkbenchTab(cmdName);
        setInput('');
        return;
      }
      if (cmdName === 'mcp') {
        useUIStore.getState().openMcpSettings();
        setInput('');
        return;
      }
    }

    let finalPrompt = trimmed;

    if (hasContext) {
      const fileContexts = contextAutocomplete.attachedContexts.filter(
        (c) => c.type === 'file' || c.type === 'folder',
      );
      const dynamicContexts = contextAutocomplete.attachedContexts.filter((c) => c.type === 'git');

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

      contextAutocomplete.clearAttachedContexts();
    }

    if (finalPrompt) {
      promptHistory.recordPrompt(finalPrompt);
    }

    onSend(finalPrompt, readyAttachmentIds.length > 0 ? readyAttachmentIds : undefined);
    setInput('');
  }, [
    input,
    contextAutocomplete,
    readyAttachmentIds,
    disabled,
    isAnyUploading,
    onSend,
    promptHistory,
    setInput,
  ]);

  const handleProviderSelect = useCallback(
    (providerId: string, modelId?: string) => {
      onProviderSelect?.(providerId, modelId);
      setIsPickerOpen(false);
    },
    [onProviderSelect],
  );

  const handleAttachClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      addFiles(e.target.files);
    }
    e.target.value = '';
  };

  const handlePaste = useCallback(
    (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
      const items = Array.from(e.clipboardData.items);
      const imageItems = items.filter((item) => item.type.startsWith('image/'));
      if (imageItems.length > 0) {
        e.preventDefault();
        const files = imageItems
          .map((item) => item.getAsFile())
          .filter((f): f is File => f !== null);
        addFiles(files);
      }
    },
    [addFiles],
  );

  const [isDraggingOver, setIsDraggingOver] = useState(false);

  const handleDragEnter = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (e.dataTransfer?.types && Array.from(e.dataTransfer.types).includes('Files')) {
      setIsDraggingOver(true);
    }
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setIsDraggingOver(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setIsDraggingOver(false);
      const files = Array.from(e.dataTransfer.files);
      const imageFiles = files.filter((f) => f.type.startsWith('image/'));
      const codeFiles = files.filter((f) => !f.type.startsWith('image/'));

      if (imageFiles.length > 0) {
        addFiles(imageFiles);
      }

      if (codeFiles.length > 0) {
        for (const file of codeFiles) {
          const filePath = (file as { path?: string }).path || file.name;
          contextAutocomplete.selectItem({
            id: filePath,
            type: 'file',
            title: file.name,
            subtitle: filePath,
            value: filePath,
          });
        }
      }
    },
    [addFiles, contextAutocomplete],
  );

  const canSend =
    !disabled &&
    !isAnyUploading &&
    (input.trim().length > 0 ||
      readyAttachmentIds.length > 0 ||
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
    branches,
    switchBranch,
    isSwitchingBranch,
    switchMode,
    isSwitchingMode,
    setApprovalMode,
    isUpdatingApprovalMode,
    setAgentPersona,
    isUpdatingAgentPersona,
    setSessionConfigOption,
    isUpdatingConfigOption,
    isLoadingSession,
    providers: installedProviders,
    isLoadingProviders,
    input,
    setInput,
    handleInputChange,
    activeCommandIndex,
    setActiveCommandIndex,
    isRunning,
    handleCancel,
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
