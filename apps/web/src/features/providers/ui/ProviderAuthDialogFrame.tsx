import type { ReactNode } from 'react';
import type { ProviderDiscovery } from '@agentctl/shared';
import { Key } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@agentctl/ui';

export function ProviderAuthDialogFrame({
  provider,
  onClose,
  children,
}: {
  provider: ProviderDiscovery;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="border-border bg-brand-mantle flex h-[560px] max-h-[90vh] flex-col p-5 shadow-2xl sm:max-w-lg">
        <DialogHeader className="shrink-0 gap-1.5">
          <div className="flex items-center gap-2.5">
            <div className="bg-accent/15 text-accent flex h-8 w-8 shrink-0 items-center justify-center rounded-lg">
              <Key className="icon-default" />
            </div>
            <DialogTitle className="text-text-main text-sm font-semibold tracking-normal normal-case">
              {provider.label} Authentication
            </DialogTitle>
          </div>
          <DialogDescription className="text-text-muted text-xs font-normal tracking-normal normal-case opacity-90">
            {provider.authState === 'authenticated' || provider.authState === 'not_required'
              ? 'Agent is connected and ready to use.'
              : 'Authenticate using the method advertised by the agent.'}
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      </DialogContent>
    </Dialog>
  );
}
