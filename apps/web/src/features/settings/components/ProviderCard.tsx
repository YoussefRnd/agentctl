import { useState } from 'react';
import type { ProviderDiscovery } from '@agentctl/shared';
import { getProviderEnvKeys, validateApiKey } from '@agentctl/shared';
import { ChevronDown, Terminal, Eye } from 'lucide-react';
import { ProviderIcon } from '@/shared/ProviderIcon';
import { Card, Button, Input, Switch } from '@agentctl/ui';

interface ProviderCardProps {
  provider: ProviderDiscovery;
  onActivate: (id: string) => void;
  onToggle: (id: string, enabled: boolean) => void;
  onResync: () => void;
  onUpdateConfig?: (
    id: string,
    updates: {
      customEnv?: Record<string, string>;
      nativelyLoadsSkills?: boolean;
    },
  ) => void;
  isUpdatingConfig?: boolean;
}

export function ProviderCard({
  provider,
  onActivate,
  onToggle,
  onResync,
  onUpdateConfig,
  isUpdatingConfig,
}: ProviderCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const envKeys = getProviderEnvKeys(provider);
  const [customEnv, setCustomEnv] = useState<Record<string, string>>(() => {
    const state: Record<string, string> = {};
    for (const key of envKeys) {
      state[key] = provider.customEnv[key] ?? '';
    }
    return state;
  });

  const hasChanges = envKeys.some((key) => customEnv[key] !== (provider.customEnv[key] ?? ''));
  const hasInvalidKeys = envKeys.some((key) => validateApiKey(key, customEnv[key] ?? '') !== null);

  const handleSaveConfig = () => {
    if (onUpdateConfig) {
      onUpdateConfig(provider.id, { customEnv });
    }
  };

  const getStatusBadge = () => {
    const baseStyles =
      'inline-flex items-center px-1.5 py-0.5 text-[9px] font-black uppercase tracking-widest border rounded-sm';

    if (!provider.enabled) {
      return (
        <span className={`${baseStyles} text-text-muted border-border/40 opacity-50`}>
          DISABLED
        </span>
      );
    }

    switch (provider.status) {
      case 'ready':
        return (
          <span className={`${baseStyles} border-accent/30 bg-accent/5 text-accent`}>READY</span>
        );
      case 'needs_auth':
        return (
          <span className={`${baseStyles} border-warning/30 bg-warning/5 text-warning`}>
            AUTH_REQ
          </span>
        );
      case 'not_found':
        return (
          <span className={`${baseStyles} border-danger/30 bg-danger/5 text-danger`}>MISSING</span>
        );
      default:
        return (
          <span className={`${baseStyles} border-border/20 text-text-muted uppercase`}>
            {provider.status}
          </span>
        );
    }
  };

  const isActive = provider.enabled;

  const handleToggle = (checked: boolean) => {
    onToggle(provider.id, checked);

    if (checked) {
      if (provider.status === 'inactive') {
        onActivate(provider.id);
      } else if (provider.status === 'needs_auth') {
        setIsExpanded(true);
      } else if (provider.status === 'not_found') {
        setIsExpanded(true);
      }
    }
  };

  return (
    <Card className="group hover:border-accent/20 overflow-hidden rounded-2xl">
      <button
        type="button"
        onClick={() => {
          setIsExpanded(!isExpanded);
        }}
        className="flex w-full cursor-pointer items-center justify-between border-none bg-transparent p-4 text-left select-none"
      >
        <div className="flex min-w-0 items-center gap-3.5">
          <ProviderIcon provider={provider} size="md" />
          <div className="min-w-0">
            <h3 className="text-text-main flex items-center gap-3 text-[13px] font-black tracking-tighter uppercase">
              {provider.label}
              {getStatusBadge()}
            </h3>
            <p className="text-text-muted mt-0.5 max-w-md truncate caption-2xs opacity-50">
              {provider.description ?? 'NO_DESCRIPTION'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div
            className="flex items-center"
            onClick={(e) => {
              e.stopPropagation();
            }}
          >
            <Switch checked={isActive} onCheckedChange={handleToggle} />
          </div>

          <ChevronDown
            className={`text-text-muted h-3.5 w-3.5 transition-transform duration-300 ${isExpanded ? 'text-text-main rotate-180' : ''}`}
          />
        </div>
      </button>

      {isExpanded && (
        <div className="animate-in fade-in slide-in-from-top-1 border-border/20 space-y-4 border-t p-4">
          <div className="space-y-1">
            <strong className="text-text-muted label-2xs opacity-45">
              DESCRIPTION
            </strong>
            <p className="text-text-main text-[11px] leading-relaxed font-bold tracking-tight uppercase">
              {provider.description ?? 'NO_DESCRIPTION_AVAILABLE'}
            </p>
          </div>

          {provider.status === 'not_found' && (
            <div className="border-danger/20 bg-danger/5 animate-in fade-in flex items-center justify-between rounded-xl border px-3 py-2">
              <span className="text-danger caption-2xs">
                BINARY_NOT_DETECTED_IN_PATH
              </span>
              <Button
                onClick={onResync}
                size="sm"
                className="h-7 px-3 text-[9px] font-bold tracking-widest uppercase"
              >
                RE_SYNC
              </Button>
            </div>
          )}

          <div className="space-y-2">
            <div className="text-text-muted flex items-center gap-1.5 label-2xs opacity-45">
              <Terminal className="h-3.5 w-3.5" />
              LAUNCH_CONFIG
            </div>
            <div className="bg-surface-secondary/40 border-border/30 text-text-muted rounded-xl border p-3 font-mono text-[11px] leading-relaxed">
              <div>
                CMD: <span className="text-text-main font-semibold">{provider.command}</span>
              </div>
              {provider.launchArgs.length > 0 && (
                <div className="mt-1">
                  ARGS:{' '}
                  <span className="text-text-main font-semibold">
                    {JSON.stringify(provider.launchArgs)}
                  </span>
                </div>
              )}
            </div>
          </div>

          <div className="border-border/55 bg-surface-secondary/20 flex items-center justify-between rounded-xl border px-4 py-3 select-none">
            <div>
              <p className="text-text-main text-[11px] font-bold tracking-tight">
                NATIVELY_LOADS_SKILLS
              </p>
              <p className="text-text-muted mt-0.5 text-[9px] leading-normal font-bold tracking-tight uppercase opacity-65">
                Bypass client-side prompt injection, letting this agent manage skills natively from
                workspace.
              </p>
            </div>
            <Switch
              checked={provider.nativelyLoadsSkills}
              onCheckedChange={(checked) => {
                if (onUpdateConfig) {
                  onUpdateConfig(provider.id, { nativelyLoadsSkills: checked });
                }
              }}
            />
          </div>
          {envKeys.length > 0 && (
            <div className="border-border/10 space-y-3 border-t pt-3.5">
              <div className="text-text-main flex items-center gap-1.5 label-2xs">
                <Eye className="text-accent h-3.5 w-3.5" />
                CREDENTIALS
              </div>
              <div className="space-y-2">
                {envKeys.map((key) => {
                  const errorMsg = validateApiKey(key, customEnv[key] ?? '');
                  return (
                    <div key={key} className="space-y-1">
                      <div className="flex items-baseline justify-between">
                        <label className="text-text-muted label-3xs">
                          {key}
                        </label>
                        {errorMsg && (
                          <span className="text-danger caption-3xs">
                            {errorMsg}
                          </span>
                        )}
                      </div>
                      <Input
                        type="password"
                        value={customEnv[key] ?? ''}
                        onChange={(e) => {
                          setCustomEnv({ ...customEnv, [key]: e.target.value });
                        }}
                        className={`h-8 w-full !text-[11px] ${errorMsg ? 'border-danger/40 focus:border-danger/60' : ''}`}
                      />
                    </div>
                  );
                })}
                {hasChanges && (
                  <div className="flex justify-end pt-1">
                    <Button
                      onClick={handleSaveConfig}
                      disabled={(isUpdatingConfig ?? false) || hasInvalidKeys}
                      className="h-7 px-3 text-[9px] font-bold tracking-widest"
                    >
                      {isUpdatingConfig ? 'SAVING...' : 'SAVE_CONFIG'}
                    </Button>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
