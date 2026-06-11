import { useState } from 'react';
import type { ProviderDiscovery } from '@agentctl/shared';
import { PROVIDER_ENV_KEYS, validateApiKey } from '@agentctl/shared';
import { ChevronDown, Terminal, Eye } from 'lucide-react';
import { GlassPanel, Button, Input } from '@agentctl/ui';

interface ProviderCardProps {
  provider: ProviderDiscovery;
  onActivate: (id: string) => void;
  onToggle: (id: string, enabled: boolean) => void;
  onResync: () => void;
  onUpdateConfig?: (id: string, customEnv: Record<string, string>) => void;
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

  const envKeys = PROVIDER_ENV_KEYS[provider.id] ?? [];
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
      onUpdateConfig(provider.id, customEnv);
    }
  };

  const getStatusBadge = () => {
    const baseStyles =
      'inline-flex items-center px-1.5 py-0.5 text-[9px] font-black uppercase tracking-widest border rounded-sm';

    if (!provider.enabled) {
      return (
        <span className={`${baseStyles} text-text-muted border-border/40 opacity-50`}>DISABLED</span>
      );
    }

    switch (provider.status) {
      case 'ready':
        return <span className={`${baseStyles} border-accent/30 bg-accent/5 text-accent`}>READY</span>;
      case 'needs_auth':
        return <span className={`${baseStyles} border-warning/30 bg-warning/5 text-warning`}>AUTH_REQ</span>;
      case 'not_found':
        return <span className={`${baseStyles} border-danger/30 bg-danger/5 text-danger`}>MISSING</span>;
      default:
        return (
          <span className={`${baseStyles} border-border/20 text-text-muted uppercase`}>
            {provider.status}
          </span>
        );
    }
  };

  const isActive = provider.enabled;

  const handleToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    const nextEnabled = !provider.enabled;
    onToggle(provider.id, nextEnabled);

    if (nextEnabled) {
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
    <GlassPanel intensity="default" className="group overflow-hidden rounded-2xl border transition-all duration-200 hover:border-accent/20">
      <div
        onClick={() => {
          setIsExpanded(!isExpanded);
        }}
        className="flex cursor-pointer items-center justify-between p-4 select-none"
      >
        <div className="flex min-w-0 items-center gap-3.5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border/30 bg-surface-secondary/40 p-1.5 transition-all group-hover:bg-surface-secondary/60">
            {provider.icon ? (
              <img src={provider.icon} alt="" className="h-5 w-5 object-contain" />
            ) : provider.id.includes('claude') ? (
              <span className="text-lg font-bold text-text-main">C</span>
            ) : (
              <Terminal className="h-4 w-4 text-text-main" />
            )}
          </div>
          <div className="min-w-0">
            <h3 className="flex items-center gap-3 text-[13px] font-black tracking-tighter text-text-main uppercase">
              {provider.label}
              {getStatusBadge()}
            </h3>
            <p className="text-text-muted mt-0.5 max-w-md truncate text-[10px] font-bold tracking-tight uppercase opacity-50">
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
            <button
              role="switch"
              aria-checked={isActive}
              onClick={handleToggle}
              className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border transition-colors duration-200 ease-in-out focus:outline-none ${isActive ? 'bg-accent border-accent' : 'bg-background border-border/40'}`}
            >
              <span
                className={`pointer-events-none inline-block h-4 w-4 transform rounded-full transition duration-200 ease-in-out ${isActive ? 'bg-brand-crust translate-x-4' : 'bg-text-muted/20 translate-x-0'}`}
              />
            </button>
          </div>

          <ChevronDown
            className={`text-text-muted h-3.5 w-3.5 transition-transform duration-300 ${isExpanded ? 'text-text-main rotate-180' : ''}`}
          />
        </div>
      </div>

      {isExpanded && (
        <div className="animate-in fade-in slide-in-from-top-1 border-border/20 space-y-4 border-t p-4">
          <div className="space-y-1">
            <strong className="text-text-muted text-[10px] font-black tracking-widest uppercase opacity-45">
              DESCRIPTION
            </strong>
            <p className="text-text-main text-[11px] font-bold tracking-tight uppercase leading-relaxed">
              {provider.description ?? 'NO_DESCRIPTION_AVAILABLE'}
            </p>
          </div>

          {provider.status === 'not_found' && (
            <div className="border-danger/20 bg-danger/5 flex items-center justify-between rounded-xl border px-3 py-2 animate-in fade-in">
              <span className="text-danger text-[10px] font-bold uppercase tracking-tight">
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
            <div className="text-text-muted flex items-center gap-1.5 text-[10px] font-black tracking-widest uppercase opacity-45">
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
                  <span className="text-text-main font-semibold">{JSON.stringify(provider.launchArgs)}</span>
                </div>
              )}
            </div>
          </div>
          {envKeys.length > 0 && (
            <div className="space-y-3 border-t border-border/10 pt-3.5">
              <div className="flex items-center gap-1.5 text-[10px] font-black tracking-widest text-text-main uppercase">
                <Eye className="h-3.5 w-3.5 text-accent" />
                CREDENTIALS
              </div>
              <div className="space-y-2">
                {envKeys.map((key) => {
                  const errorMsg = validateApiKey(key, customEnv[key] ?? '');
                  return (
                    <div key={key} className="space-y-1">
                      <div className="flex items-baseline justify-between">
                        <label className="text-text-muted text-[9px] font-black tracking-widest uppercase">
                          {key}
                        </label>
                        {errorMsg && (
                          <span className="text-danger text-[9px] font-bold tracking-tight uppercase">
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
                        className={`w-full h-8 !text-[11px] ${errorMsg ? 'border-danger/40 focus:border-danger/60' : ''}`}
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
    </GlassPanel>
  );
}
