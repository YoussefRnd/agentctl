export interface TerminalPaneHandle {
  restart: () => void;
  clear: () => void;
  focus: () => void;
  fit: () => void;
}

export interface TerminalPaneProps {
  id: string;
  name: string;
  sessionId: string;
  isActive: boolean;
  isSplit: boolean;
  splitOrientation?: 'horizontal' | 'vertical';
  codeFont?: { family?: string; size?: number };
  onFocus: (id: string) => void;
  onClose?: (id: string) => void;
  onToggleOrientation?: () => void;
  onShellChange?: (id: string, shell: string) => void;
  onStatusChange?: (id: string, status: 'connecting' | 'connected' | 'disconnected') => void;
}
