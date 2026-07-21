import { useState, useEffect, useCallback, useRef } from 'react';

import { useSession } from '../../../contexts/SessionContext';
import { api } from '@agentctl/api-client';
import { useProviders } from '../../../hooks/useProviders';
import { useActionDispatcher } from '../../../hooks/useActionDispatcher';
import { useAttachments } from '../../../hooks/useAttachments';
import { useMcpTools } from '../../../hooks/useMcpServers';

const CLIENT_COMMANDS = [
  {
    name: 'mcp',
    description: 'Manage MCP servers and integrations',
    category: 'client',
  },
] as const;

interface CommandInfo {
  name: string;
  description?: string;
  input?: { hint?: string };
  category?: string;
}

export function useCommandBarState({
  onSend,
  disabled,
  propSelectedProviderId,
  onProviderSelect,
  initialInput,
}: {
  onSend: (val: string, attachmentIds?: string[]) => void;
  disabled?: boolean;
  propSelectedProviderId?: string | null;
  onProviderSelect?: (id: string, modelId?: string) => void;
  initialInput?: string;
}) {
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
    updateProvider,
    isLoadingSession,
  } = useSession();
  const { providers, isLoadingProviders } = useProviders(sessionId);
  const { execute } = useActionDispatcher();
  const { tools: mcpTools } = useMcpTools();
  const [input, setInput] = useState('');
  const [activeCommandIndex, setActiveCommandIndex] = useState(0);

  const handleInputChange = useCallback((value: string) => {
    setInput(value);
    setActiveCommandIndex(0);
  }, []);

  const isRunning = sessionData?.session.status === 'running';

  const handleCancel = useCallback(() => {
    if (!sessionId) return;
    void api.cancelSession({ params: { id: sessionId }, body: {} });
  }, [sessionId]);

  const commandRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const availableCommands = sessionData?.session.availableCommands ?? [];
  const mcpCommandList = mcpTools.map((t) => ({
    name: `${t.serverId}:${t.name.split('__')[1] ?? t.name}`,
    description: t.description ?? 'MCP Tool',
    category: 'mcp',
  }));
  const combinedCommands: CommandInfo[] = [
    ...availableCommands,
    ...mcpCommandList,
    ...CLIENT_COMMANDS,
  ];

  const showSlashMenu =
    input.startsWith('/') && !input.includes(' ') && combinedCommands.length > 0;

  const filteredCommands = showSlashMenu
    ? combinedCommands.filter((cmd) =>
        cmd.name.toLowerCase().startsWith(input.slice(1).toLowerCase()),
      )
    : [];

  const parsedCommandParts = input.startsWith('/') ? input.slice(1).split(' ') : [];
  const typedCommandName = parsedCommandParts[0];
  const matchingCommand =
    !showSlashMenu && typedCommandName
      ? combinedCommands.find((c) => c.name.toLowerCase() === typedCommandName.toLowerCase())
      : undefined;

  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { attachments, addFiles, removeAttachment, clearAll, readyAttachmentIds, isAnyUploading } =
    useAttachments(sessionId);

  const selectedId = propSelectedProviderId ?? null;

  const installedProviders = providers.filter((p) => p.installState !== 'not_installed');
  const firstId = installedProviders[0]?.id ?? null;
  const resolvedId = selectedId ?? firstId;
  const activeProvider = installedProviders.find((p) => p.id === resolvedId);
  const selectedProviderLabel =
    activeProvider !== undefined ? activeProvider.label : 'Select provider';

  const handleSubmit = useCallback(() => {
    const hasText = input.trim().length > 0;
    const hasAttachments = readyAttachmentIds.length > 0;
    if ((!hasText && !hasAttachments) || disabled || isAnyUploading) return;

    onSend(input, readyAttachmentIds.length > 0 ? readyAttachmentIds : undefined);
    handleInputChange('');
    clearAll();
  }, [input, readyAttachmentIds, disabled, isAnyUploading, onSend, clearAll, handleInputChange]);

  const handleProviderSelect = (id: string, modelId?: string) => {
    if (onProviderSelect) {
      onProviderSelect(id, modelId);
    } else {
      void execute(
        'switch-provider',
        async () => {
          await updateProvider(id, modelId);
        },
        { successMessage: `Switched to ${id}` },
      );
    }
    setIsPickerOpen(false);
  };

  useEffect(() => {
    if (initialInput !== undefined) {
      setInput(initialInput);
    }
  }, [initialInput]);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${String(textareaRef.current.scrollHeight)}px`;
    }
  }, [input]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isPickerOpen) {
        setIsPickerOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isPickerOpen]);

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
      const files = Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith('image/'));
      if (files.length > 0) addFiles(files);
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
