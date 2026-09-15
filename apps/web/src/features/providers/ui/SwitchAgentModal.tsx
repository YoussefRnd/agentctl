import { useState } from 'react';
import { ArrowRight, Bot, Loader2, Sparkles } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  Button,
} from '@agentctl/ui';

export interface SwitchAgentModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentProvider: string;
  targetProvider: string;
  targetModel?: string;
  onConfirm: (nextSessionFocus?: string) => void;
  isLoading?: boolean;
}

export function SwitchAgentModal({
  open,
  onOpenChange,
  currentProvider,
  targetProvider,
  targetModel,
  onConfirm,
  isLoading = false,
}: SwitchAgentModalProps) {
  const [focusNotes, setFocusNotes] = useState('');

  const handleConfirm = () => {
    onConfirm(focusNotes.trim() || undefined);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md overflow-hidden rounded-2xl p-0">
        <div className="p-5">
          <DialogHeader className="mb-4">
            <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-xl bg-white/5 ring-1 ring-white/10">
              <Bot className="text-accent h-4.5 w-4.5" />
            </div>
            <DialogTitle>Switch Agent</DialogTitle>
            <DialogDescription className="text-text-muted text-xs font-normal">
              Transfer conversation context to {targetProvider} without changing workspaces
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {/* Provider transition badge */}
            <div className="flex items-center justify-center gap-3 rounded-xl border border-white/5 bg-white/[0.02] p-3 text-xs">
              <span className="text-text-muted font-mono font-medium capitalize">
                {currentProvider}
              </span>
              <ArrowRight className="text-text-muted/60 h-3.5 w-3.5" />
              <div className="flex items-center gap-1.5">
                <span className="text-text-main font-mono font-semibold capitalize">
                  {targetProvider}
                </span>
                {targetModel && targetModel !== 'default' && (
                  <span className="text-text-muted rounded bg-white/10 px-1.5 py-0.5 font-mono text-[10px]">
                    {targetModel}
                  </span>
                )}
              </div>
            </div>

            {/* Focus note input */}
            <div className="space-y-1.5">
              <label
                htmlFor="session-focus-input"
                className="text-text-main flex items-center justify-between text-xs font-medium"
              >
                <span>What will the next session be used for?</span>
                <span className="text-text-muted text-[10px]">Optional</span>
              </label>
              <textarea
                id="session-focus-input"
                value={focusNotes}
                onChange={(e) => setFocusNotes(e.target.value)}
                placeholder="e.g. Focus on finishing animation curves, or pick up from the latest test failure..."
                rows={3}
                disabled={isLoading}
                className="text-text-main placeholder:text-text-muted/50 focus:border-accent focus:ring-accent w-full resize-none rounded-xl border border-white/10 bg-black/20 p-2.5 text-xs focus:ring-1 focus:outline-none disabled:opacity-50"
              />
            </div>

            {/* Handoff behavior */}
            <div className="bg-accent/5 border-accent/15 text-text-muted flex items-start gap-2 rounded-xl border p-2.5 text-[11px]">
              <Sparkles className="text-accent mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                Agentctl activates its managed handoff skill. If the source agent cannot complete
                it, agentctl generates fallback transfer context.{' '}
                <strong className="text-text-main capitalize">{targetProvider}</strong> continues in
                this session and the same workspace.
              </span>
            </div>
          </div>

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
              variant="solid"
              size="sm"
              onClick={handleConfirm}
              disabled={isLoading}
            >
              {isLoading ? (
                <>
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  Transferring Context...
                </>
              ) : (
                `Switch to ${targetProvider}`
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
