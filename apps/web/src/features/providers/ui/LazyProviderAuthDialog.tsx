import { lazy, Suspense } from 'react';
import type { ProviderAuthDialogProps } from './ProviderAuthDialog';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@agentctl/ui';

const AuthDialog = lazy(() =>
  import('./ProviderAuthDialog').then((module) => ({ default: module.ProviderAuthDialog })),
);

export function ProviderAuthDialog(props: ProviderAuthDialogProps) {
  if (!props.isOpen || !props.provider) return null;
  return (
    <Suspense
      fallback={
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) props.onClose();
          }}
        >
          <DialogContent>
            <DialogTitle>{props.provider.label} Authentication</DialogTitle>
            <DialogDescription role="status">Loading authentication…</DialogDescription>
          </DialogContent>
        </Dialog>
      }
    >
      <AuthDialog {...props} />
    </Suspense>
  );
}
