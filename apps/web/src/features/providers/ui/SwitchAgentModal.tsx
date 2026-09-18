import { useState, useMemo } from 'react';
import { Loader2, Sparkles, PlusCircle } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  Button,
  Input,
  cn,
} from '@agentctl/ui';
import { useProviders } from '../api/useProviders.js';

export type SwitchAgentMode = 'handoff' | 'new_session';

export interface SwitchAgentModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentProvider: string;
  targetProvider: string;
  targetModel?: string;
  onConfirmHandoff: (nextSessionFocus?: string) => void;
  onConfirmNewSession: () => void;
  isLoading?: boolean;
}

function formatProviderName(id: string): string {
  return id
    .split(/[-_]/)
    .map((word) =>
      word.length <= 3 ? word.toUpperCase() : word.charAt(0).toUpperCase() + word.slice(1),
    )
    .join(' ');
}

export function SwitchAgentModal({
  open,
  onOpenChange,
  targetProvider,
  targetModel,
  onConfirmHandoff,
  onConfirmNewSession,
  isLoading = false,
}: SwitchAgentModalProps) {
  const [selectedMode, setSelectedMode] = useState<SwitchAgentMode>('handoff');
  const [focusNotes, setFocusNotes] = useState('');

  const { providers = [] } = useProviders(null);

  const targetName = useMemo(() => {
    const match = providers.find((p) => p.id === targetProvider);
    return match?.label || formatProviderName(targetProvider);
  }, [providers, targetProvider]);

  const handleConfirm = () => {
    if (selectedMode === 'handoff') {
      onConfirmHandoff(focusNotes.trim() || undefined);
    } else {
      onConfirmNewSession();
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-border/40 bg-surface max-w-sm overflow-hidden rounded-2xl border p-0 shadow-2xl">
        <div className="p-5">
          {/* Header */}
          <DialogHeader className="mb-4 text-left">
            <DialogTitle className="text-text-main text-sm font-semibold tracking-tight">
              Switch to {targetName}
            </DialogTitle>
            <DialogDescription className="text-text-muted mt-0.5 text-xs">
              {targetModel && targetModel !== 'default' && (
                <span className="text-text-main/80 mr-1 font-mono">{targetModel} &middot;</span>
              )}
              Choose how to proceed in this workspace
            </DialogDescription>
          </DialogHeader>

          {/* Segmented Control */}
          <div className="border-border/30 bg-surface-secondary/40 grid grid-cols-2 gap-1 rounded-xl border p-1">
            <button
              type="button"
              onClick={() => setSelectedMode('handoff')}
              className={cn(
                'flex cursor-pointer items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all select-none',
                selectedMode === 'handoff'
                  ? 'border-border/40 bg-surface text-text-main border font-semibold shadow-xs'
                  : 'text-text-muted hover:text-text-main',
              )}
            >
              <Sparkles
                className={cn(
                  'h-3.5 w-3.5',
                  selectedMode === 'handoff' ? 'text-accent' : 'text-text-muted/60',
                )}
              />
              <span>Handoff</span>
            </button>

            <button
              type="button"
              onClick={() => setSelectedMode('new_session')}
              className={cn(
                'flex cursor-pointer items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all select-none',
                selectedMode === 'new_session'
                  ? 'border-border/40 bg-surface text-text-main border font-semibold shadow-xs'
                  : 'text-text-muted hover:text-text-main',
              )}
            >
              <PlusCircle
                className={cn(
                  'h-3.5 w-3.5',
                  selectedMode === 'new_session' ? 'text-accent' : 'text-text-muted/60',
                )}
              />
              <span>New Session</span>
            </button>
          </div>

          {/* Mode Details */}
          <div className="mt-3.5 space-y-3 text-left">
            {selectedMode === 'handoff' ? (
              <>
                <p className="text-text-muted text-xs leading-relaxed">
                  Transfers conversation summary, modified files, and git state so{' '}
                  <strong className="text-text-main font-medium">{targetName}</strong> continues
                  this task.
                </p>

                <div className="space-y-1.5 pt-1">
                  <label
                    htmlFor="session-focus-input"
                    className="text-text-muted/80 flex items-center justify-between text-[11px] font-medium"
                  >
                    <span>Focus instruction</span>
                    <span className="text-text-muted/40 text-[10px] font-normal">Optional</span>
                  </label>
                  <Input
                    id="session-focus-input"
                    value={focusNotes}
                    onChange={(e) => setFocusNotes(e.target.value)}
                    placeholder="e.g. Focus on finishing animation curves..."
                    disabled={isLoading}
                    sizeVariant="sm"
                    className="font-sans text-xs"
                  />
                </div>
              </>
            ) : (
              <p className="text-text-muted py-1 text-xs leading-relaxed">
                Starts a clean session with{' '}
                <strong className="text-text-main font-medium">{targetName}</strong> in this
                workspace. Your current session remains saved in the sidebar.
              </p>
            )}
          </div>

          {/* Actions */}
          <div className="mt-6 flex items-center justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onOpenChange(false)}
              disabled={isLoading}
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={handleConfirm}
              disabled={isLoading}
              className="bg-accent text-brand-crust cursor-pointer shadow-[0_0_20px_rgba(203,166,247,0.25)] hover:opacity-90 active:scale-95"
            >
              {isLoading ? (
                <>
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  {selectedMode === 'handoff' ? 'Transferring...' : 'Creating...'}
                </>
              ) : selectedMode === 'handoff' ? (
                'Handoff & Continue'
              ) : (
                'Start Fresh Session'
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
