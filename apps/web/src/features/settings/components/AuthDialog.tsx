import { useState, useEffect } from 'react';
import type { ProviderDiscovery } from '@agentctl/shared';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
  Button,
  Input,
} from '@agentctl/ui';

interface AuthDialogProps {
  provider: ProviderDiscovery | null;
  onClose: () => void;
  onSaveEnv: (providerId: string, customEnv: Record<string, string>) => void;
  onRefresh: (providerId: string) => void;
}

export function AuthDialog({ provider, onClose, onSaveEnv, onRefresh }: AuthDialogProps) {
  const [customEnv, setCustomEnv] = useState<Record<string, string>>({});

  useEffect(() => {
    if (provider) {
      const initial: Record<string, string> = {};
      for (const method of provider.agent?.authMethods ?? []) {
        if (method.type === 'env_var') {
          for (const v of method.vars ?? []) {
            initial[v.name] = provider.customEnv[v.name];
          }
        }
      }
      setCustomEnv(initial);
    }
  }, [provider]);

  const authMethods = provider?.agent?.authMethods ?? [];

  return (
    <Dialog
      open={!!provider}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent className="max-w-md">
        {provider && (
          <>
            <DialogHeader>
              <DialogTitle>Auth — {provider.agent?.name ?? provider.label}</DialogTitle>
            </DialogHeader>

            <div className="space-y-4">
              {authMethods.map((method) => {
                if (method.type === 'env_var') {
                  return (
                    <div key={method.id} className="space-y-2">
                      {(method.vars ?? []).map((v) => (
                        <div key={v.name} className="space-y-1">
                          <label className="text-text-muted label-3xs">
                            {v.label ?? v.name}
                          </label>
                          <Input
                            type="password"
                            value={customEnv[v.name] ?? ''}
                            onChange={(e) =>
                              { setCustomEnv({ ...customEnv, [v.name]: e.target.value }); }
                            }
                            placeholder={v.name}
                          />
                        </div>
                      ))}
                    </div>
                  );
                } else {
                  return (
                    <div key={method.id} className="space-y-2">
                      <p className="text-text-muted text-[11px] leading-relaxed">
                        Run <code className="text-text-main font-mono">{provider.command} login</code>{' '}
                        in your terminal, then refresh.
                      </p>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          onRefresh(provider.id);
                          onClose();
                        }}
                      >
                        I&apos;ve logged in → refresh
                      </Button>
                    </div>
                  );
                }

                return null;
              })}
            </div>

            <DialogFooter>
              <DialogClose asChild>
                <Button variant="ghost" size="sm" onClick={onClose}>
                  Cancel
                </Button>
              </DialogClose>
              <Button
                variant="solid"
                size="sm"
                onClick={() => {
                  onSaveEnv(provider.id, customEnv);
                  onClose();
                }}
              >
                Save
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
