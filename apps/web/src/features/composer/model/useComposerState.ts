import { useComposerFiles } from './useComposerFiles';
import { useComposerDraft } from './useComposerDraft';
import { useFrameScheduler } from '@/shared/hooks/useFrameScheduler';
import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import type { SessionWithCapabilities, SessionEventRow } from '@agentctl/shared';
import type { ContextItem } from '@agentctl/api-client';
import { useAttachments } from './useAttachments';
import { useContextAutocomplete } from './useContextAutocomplete';
import { usePromptHistory } from './usePromptHistory';
import { fuzzySearch, resolveAgentFeatures, type ProviderDiscovery } from '@agentctl/shared';
import { useSettingsOverlayStore } from '@/features/settings';
import { useWorkbenchStore } from '@/shared/stores/useWorkbenchStore';
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

  const [activeCommandIndex, setActiveCommandIndex] = useState(0);
  const commandRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const scheduleFrame = useFrameScheduler(draftKey);
  const { input, setInput } = useComposerDraft({
    draftKey,
    initialInput,
    textareaRef,
    setActiveCommandIndex,
  });
  const pendingContextItem = useDraftStore((s) => s.pendingContextItem);
  const clearPendingContextItem = useDraftStore((s) => s.clearPendingContextItem);
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

    scheduleFrame(() => {
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
    [promptHistory, setInput],
  );

  const handleHistoryUp = useCallback(() => {
    const textarea = textareaRef.current;
    const isAtStart =
      !input || (textarea ? textarea.selectionStart === 0 && textarea.selectionEnd === 0 : true);
    const prev = promptHistory.navigateUp(input, isAtStart);
    if (prev !== null) {
      setInput(prev);
      scheduleFrame(() => {
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
      scheduleFrame(() => {
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
    return fuzzySearch(commands, input.slice(1), (command) => [command.name]);
  }, [isSlashCommand, input, commands]);

  const showSlashMenu = isSlashCommand && !/\s/.test(input);

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
          const resolved = await contextAutocomplete.resolveAttachedContexts(dynamicContexts);
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

  const {
    fileInputRef,
    handleAttachClick,
    handleFileInputChange,
    handlePaste,
    handleDrop,
    isDraggingOver,
    handleDragEnter,
    handleDragLeave,
  } = useComposerFiles({ addFiles, contextAutocomplete, supportsImageAttachments });
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
