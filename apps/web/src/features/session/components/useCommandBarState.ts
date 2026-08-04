import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useSession } from '../../../contexts/SessionContext';
import { useProviders } from '../../../hooks/useProviders';
import { useAttachments } from '../../../hooks/useAttachments';
import { useSessionActions } from '../../../hooks/useSessionActions';
import type { ProviderDiscovery } from '@agentctl/shared';

export interface CommandInfo {
  name: string;
  description?: string;
  input?: { hint?: string };
  category?: string;
}

const DEFAULT_COMMANDS: CommandInfo[] = [
  { name: 'clear', description: 'Clear the current conversation view', category: 'Session' },
  { name: 'mcp', description: 'Manage MCP server tools & status', category: 'System' },
  { name: 'plan', description: 'View structured task execution plan', category: 'Agent' },
  { name: 'compact', description: 'Compact conversation history', category: 'Session' },
];

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

  const [input, setInput] = useState('');
  const [activeCommandIndex, setActiveCommandIndex] = useState(0);

  useEffect(() => {
    if (initialInput && initialInput.trim().length > 0) {
      setInput(initialInput);
    }
  }, [initialInput]);

  const isRunning = sessionData?.session.status === 'running';

  const commands = DEFAULT_COMMANDS;
  const commandRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleInputChange = useCallback((val: string) => {
    setInput(val);
    setActiveCommandIndex(0);
  }, []);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = `${String(Math.min(textarea.scrollHeight, 240))}px`;
  }, [input]);

  const isSlashCommand = input.startsWith('/') && !input.includes('\n');
  const slashQuery = isSlashCommand ? input.slice(1).toLowerCase() : '';

  const filteredCommands = useMemo<CommandInfo[]>(() => {
    if (!isSlashCommand) return [];
    return commands.filter(
      (cmd: CommandInfo) =>
        cmd.name.toLowerCase().includes(slashQuery) ||
        (cmd.description?.toLowerCase().includes(slashQuery) ?? false),
    );
  }, [isSlashCommand, commands, slashQuery]);

  const matchingCommand = useMemo<CommandInfo | undefined>(() => {
    if (!isSlashCommand) return undefined;
    const parts = input.slice(1).split(' ');
    const cmdName = parts[0].toLowerCase();
    return commands.find((cmd: CommandInfo) => cmd.name.toLowerCase() === cmdName);
  }, [isSlashCommand, input, commands]);

  const showSlashMenu = isSlashCommand && filteredCommands.length > 0 && !input.includes(' ');

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

  const handleSubmit = useCallback(() => {
    const trimmed = input.trim();
    if (!trimmed && readyAttachmentIds.length === 0) return;
    if (disabled || isAnyUploading) return;

    onSend(trimmed, readyAttachmentIds.length > 0 ? readyAttachmentIds : undefined);
    setInput('');

    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  }, [input, readyAttachmentIds, disabled, isAnyUploading, onSend]);

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

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      const files = Array.from(e.dataTransfer.files);
      const imageFiles = files.filter((f) => f.type.startsWith('image/'));
      const nonImageFiles = files.filter((f) => !f.type.startsWith('image/'));

      if (nonImageFiles.length > 0) {
        void import('sonner').then(({ toast }) => {
          toast.error(
            `Unsupported file format: ${nonImageFiles.map((f) => f.name).join(', ')}. Only images (PNG, JPEG, GIF, WebP) are supported.`,
          );
        });
      }

      if (imageFiles.length > 0) {
        addFiles(imageFiles);
      }
    },
    [addFiles],
  );

  const canSend =
    !disabled && !isAnyUploading && (input.trim().length > 0 || readyAttachmentIds.length > 0);

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
    canSend,
    handleSelectCommand,
  };
}
