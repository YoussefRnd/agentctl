import { useEffect, useState, useRef } from 'react';
import type { ProviderDiscovery } from '@agentctl/shared';
import { SearchBar, Card } from '@agentctl/ui';
import { RegistryCard } from './RegistryCard';
import { AuthDialog } from './AuthDialog';

interface ProvidersApi {
  providers: ProviderDiscovery[];
  isLoadingProviders: boolean;
  registry: ProviderDiscovery[];
  isLoadingRegistry: boolean;
  syncProviders: () => void;
  isSyncing: boolean;
  installProvider: (id: string) => void;
  isInstalling: boolean;
  installingProviderId: string | null;
  removeProvider: (id: string) => void;
  isRemoving: boolean;
  removingProviderId: string | null;
  logoutProvider: (id: string) => void;
  updateProviderConfig: (params: {
    providerId: string;
    customEnv?: Record<string, string>;
    nativelyLoadsSkills?: boolean;
  }) => void;
  isUpdatingConfig: boolean;
  login: (params: { providerId: string; methodId: string }) => void;
  isLoggingIn: boolean;
  refreshProvider: (id: string) => void;
  isRefreshing: boolean;
}

interface RegistryBrowserProps {
  settings: { registrySyncError?: string | null } | undefined;
  api: ProvidersApi;
}

type StatusFilter = 'all' | 'installed' | 'not_installed';

const statusChipClass = (active: boolean) =>
  `cursor-pointer rounded-lg px-3 py-1.5 text-[10px] font-bold tracking-wider uppercase transition-colors ${
    active
      ? 'bg-accent text-brand-crust shadow-sm'
      : 'text-text-muted hover:text-text-main hover:bg-surface/60'
  }`;

export function RegistryBrowser({ settings, api }: RegistryBrowserProps) {
  const { syncProviders } = api;
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [authProvider, setAuthProvider] = useState<ProviderDiscovery | null>(null);

  const hasSyncedRef = useRef(false);

  useEffect(() => {
    if (hasSyncedRef.current) return;
    hasSyncedRef.current = true;
    syncProviders();
  }, [syncProviders]);

  const matchesQuery = (p: ProviderDiscovery) => {
    const q = query.toLowerCase().trim();
    if (!q) return true;
    const label = p.label.toLowerCase();
    const name = (p.agent?.name ?? '').toLowerCase();
    const id = (p.agent?.id ?? '').toLowerCase();
    const desc = (p.agent?.description ?? '').toLowerCase();

    if (label.includes(q) || name.includes(q) || id.includes(q)) return true;

    const descWords = desc.split(/[^a-z0-9]+/).filter(Boolean);
    return descWords.some((w) => w === q || w.startsWith(q));
  };

  const queryScore = (p: ProviderDiscovery): number => {
    const q = query.toLowerCase().trim();
    if (!q) return 0;
    const label = p.label.toLowerCase();
    const name = (p.agent?.name ?? '').toLowerCase();
    const id = (p.agent?.id ?? '').toLowerCase();
    let s = 0;
    if (label === q || name === q || id === q) s += 100;
    if (label.startsWith(q) || name.startsWith(q) || id.startsWith(q)) s += 40;
    if (label.includes(q) || name.includes(q) || id.includes(q)) s += 15;
    const descWords = (p.agent?.description ?? '')
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(Boolean);
    if (descWords.some((w) => w === q)) s += 8;
    if (descWords.some((w) => w.startsWith(q))) s += 3;
    return s;
  };

  const matchesStatus = (p: ProviderDiscovery) => {
    switch (statusFilter) {
      case 'installed':
        return p.installState !== 'not_installed';
      case 'not_installed':
        return p.installState === 'not_installed';
      default:
        return true;
    }
  };

  const filtered = api.registry
    .filter((p) => matchesQuery(p) && matchesStatus(p))
    .sort((a, b) => queryScore(b) - queryScore(a));

  const activeDialogProvider = authProvider
    ? (api.registry.find((p) => p.id === authProvider.id) ??
      api.providers.find((p) => p.id === authProvider.id) ??
      authProvider)
    : null;

  return (
    <div className="relative z-10 space-y-4">
      {settings?.registrySyncError && (
        <Card status="error" className="p-4">
          <p className="text-text-main text-[12px] font-bold tracking-tight">
            {settings.registrySyncError}
          </p>
          <p className="text-text-muted mt-0.5 text-[10px] tracking-wider uppercase opacity-70">
            Registry sync failed — showing last known providers
          </p>
        </Card>
      )}

      {/* Top search & filter bar matching the reference image layout */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 flex-1">
          <SearchBar
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
            }}
            onClear={() => {
              setQuery('');
            }}
            placeholder="Search agents..."
          />
        </div>

        <div className="flex flex-wrap items-center justify-start gap-1 sm:justify-end">
          {(['all', 'installed', 'not_installed'] as StatusFilter[]).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => {
                setStatusFilter(f);
              }}
              className={statusChipClass(statusFilter === f)}
            >
              {f === 'all' ? 'All' : f === 'installed' ? 'Installed' : 'Not Installed'}
            </button>
          ))}
        </div>
      </div>

      {api.isLoadingRegistry ? (
        <div className="animate-pulse space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-24 rounded-xl border border-white/5 bg-white/5" />
          ))}
        </div>
      ) : (
        <div className="grid gap-3">
          {filtered.map((p) => (
            <RegistryCard
              key={p.id}
              provider={p}
              onInstall={api.installProvider}
              onRemove={api.removeProvider}
              onAuth={(provider) => {
                setAuthProvider(provider);
              }}
              onLogout={api.logoutProvider}
              isInstalling={api.installingProviderId === p.id}
              isRemoving={api.removingProviderId === p.id}
            />
          ))}

          {filtered.length === 0 && (
            <Card className="bg-surface-secondary/5 border-dashed p-8 text-center">
              <div className="text-text-muted text-[10px] font-bold tracking-widest uppercase opacity-35">
                No agents found
              </div>
            </Card>
          )}
        </div>
      )}

      <AuthDialog
        provider={activeDialogProvider}
        onClose={() => {
          setAuthProvider(null);
        }}
        onSaveEnv={(id, env) => {
          api.updateProviderConfig({ providerId: id, customEnv: env });
        }}
        onRefresh={(id) => {
          api.refreshProvider(id);
        }}
        onLogin={api.login}
        isLoggingIn={api.isLoggingIn}
        isUpdatingConfig={api.isUpdatingConfig}
        isRefreshing={api.isRefreshing}
      />
    </div>
  );
}
