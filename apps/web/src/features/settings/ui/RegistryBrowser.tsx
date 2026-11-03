import { SegmentedControl } from '@agentctl/ui';
import { RegistryCardsLayout } from './SettingsListLayouts';
import { RegistryToolbarLayout } from './SettingsListLayouts';
import { RegistryCardSkeleton } from './RegistryCard';
import { useEffect, useState, useRef } from 'react';
import type { ProviderDiscovery } from '@agentctl/shared';
import { SearchBar, Card, LoadingSkeleton } from '@agentctl/ui';
import { RegistryCard } from './RegistryCard';
import { ProviderAuthDialog } from '@/features/providers';

interface ProvidersApi {
  providers: ProviderDiscovery[];
  isLoadingProviders: boolean;
  registry: ProviderDiscovery[];
  isLoadingRegistry: boolean;
  syncProviders: () => void;
  isSyncing: boolean;
  installProvider: (id: string) => void;
  cancelInstall: (id: string) => void;
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

export function RegistryBrowser(props: RegistryBrowserProps) {
  const { syncProviders } = props.api;
  const hasSyncedRef = useRef(false);
  useEffect(() => {
    if (hasSyncedRef.current) return;
    hasSyncedRef.current = true;
    syncProviders();
  }, [syncProviders]);
  return <RegistryBrowserPresentation {...props} />;
}

export function RegistryBrowserPresentation({ settings, api }: RegistryBrowserProps) {
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [authProvider, setAuthProvider] = useState<ProviderDiscovery | null>(null);

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
    const isInstalled =
      p.installState === 'installed_local' || p.installState === 'system_available';
    switch (statusFilter) {
      case 'installed':
        return isInstalled;
      case 'not_installed':
        return !isInstalled;
      default:
        return true;
    }
  };

  const filtered = [...api.registry, ...api.providers.filter((provider) => provider.isProfile)]
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

      {/* Top search & filter bar */}
      <RegistryToolbarLayout
        search={
          <>
            <SearchBar
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
              }}
              onClear={() => {
                setQuery('');
              }}
              placeholder="Search providers & agents..."
            />
          </>
        }
        filters={
          <SegmentedControl
            aria-label="Filter providers"
            value={statusFilter}
            onValueChange={setStatusFilter}
            options={[
              { value: 'all', label: 'All' },
              { value: 'installed', label: 'Installed' },
              { value: 'not_installed', label: 'Available' },
            ]}
          />
        }
      />

      {api.isLoadingRegistry ? (
        <LoadingSkeleton message="Loading provider registry…" className="space-y-3">
          <RegistryCardsLayout>
            {Array.from({ length: 3 }, (_, i) => (
              <RegistryCardSkeleton key={i} />
            ))}
          </RegistryCardsLayout>
        </LoadingSkeleton>
      ) : (
        <RegistryCardsLayout>
          {filtered.map((p) => (
            <RegistryCard
              key={p.id}
              provider={p}
              onInstall={api.installProvider}
              onCancelInstall={api.cancelInstall}
              onRefresh={api.refreshProvider}
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
        </RegistryCardsLayout>
      )}

      <ProviderAuthDialog
        provider={activeDialogProvider}
        isOpen={!!activeDialogProvider}
        onClose={() => {
          setAuthProvider(null);
        }}
      />
    </div>
  );
}
