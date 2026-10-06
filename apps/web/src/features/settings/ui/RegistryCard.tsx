import { resolveAgentFeatures, type ProviderDiscovery } from '@agentctl/shared';
import {
  AlertTriangle,
  ChevronDown,
  Download,
  ExternalLink,
  KeyRound,
  Loader2,
  LogOut,
  MoreHorizontal,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import { ProviderIcon } from '@/shared';
import {
  Button,
  Card,
  DropdownContent,
  DropdownItem,
  DropdownRoot,
  DropdownSeparator,
  DropdownTrigger,
} from '@agentctl/ui';

function GithubIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4" />
      <path d="M9 18c-4.51 2-5-2-7-2" />
    </svg>
  );
}

interface RegistryCardProps {
  provider: ProviderDiscovery;
  onInstall: (id: string) => void;
  onCancelInstall: (id: string) => void;
  onRefresh: (id: string) => void;
  onRemove: (id: string) => void;
  onAuth: (provider: ProviderDiscovery) => void;
  onLogout: (id: string) => void;
  isInstalling: boolean;
  isRemoving: boolean;
}

function formatMiB(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

const authStateConfig: Record<string, { label: string; className: string }> = {
  authenticated: { label: 'Authenticated', className: 'bg-emerald-400' },
  required: { label: 'Auth required', className: 'bg-amber-400' },
  needs_auth: { label: 'Auth required', className: 'bg-amber-400' },
  authenticating: { label: 'Authenticating', className: 'bg-blue-400' },
  verifying: { label: 'Verifying', className: 'bg-purple-400' },
  error: { label: 'Auth error', className: 'bg-red-400' },
};

export function RegistryCard({
  provider,
  onInstall,
  onCancelInstall,
  onRefresh,
  onRemove,
  onAuth,
  onLogout,
  isInstalling: isInstallingProp,
  isRemoving,
}: RegistryCardProps) {
  const name = provider.isProfile ? provider.label : (provider.agent?.name ?? provider.label);
  const providerId = provider.agent?.id ?? provider.id;
  const isInstalled =
    provider.installState === 'installed_local' || provider.installState === 'system_available';
  const isInstalling =
    isInstallingProp || provider.installState === 'installing' || provider.installStage != null;
  const isFailed = provider.installState === 'failed';
  const hasAuth =
    (provider.agent?.authMethods?.length ?? 0) > 0 || (provider.authMethods?.length ?? 0) > 0;
  const isAuthed = provider.authState === 'authenticated';
  const canLogout = resolveAgentFeatures(provider).authentication.logout && isAuthed;
  const authStatus = isInstalled && hasAuth ? authStateConfig[provider.authState] : undefined;
  const repositoryUrl = provider.agent?.repository;
  const websiteUrl = provider.agent?.website;
  const showMenu = isInstalled || !!repositoryUrl || !!websiteUrl;
  const errorText = provider.installError?.replace(/^[A-Z_]+:\s*/, '');
  const hasInstallError = !!provider.installError && (isInstalled || isFailed);
  const hasConnectionError = isInstalled && provider.connectionState === 'error';
  const currentVersion = provider.installedVersion ?? provider.version;
  const downloadProgress =
    provider.installStage === 'downloading' ? provider.installProgress : null;
  const downloadPercent = downloadProgress?.totalBytes
    ? Math.min(
        100,
        Math.floor((downloadProgress.downloadedBytes / downloadProgress.totalBytes) * 100),
      )
    : null;
  const versionLabel =
    provider.updateAvailable && provider.installedVersion
      ? `v${provider.installedVersion} → v${provider.availableVersion ?? provider.version}`
      : currentVersion
        ? `v${currentVersion}`
        : null;

  let primaryAction: React.ReactNode;
  if (isInstalling) {
    primaryAction = (
      <Button variant="outline" size="sm" onClick={() => onCancelInstall(provider.id)}>
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Cancel
      </Button>
    );
  } else if (!isInstalled) {
    primaryAction = (
      <Button
        variant={isFailed ? 'solid' : 'outline'}
        size="sm"
        onClick={() => onInstall(provider.id)}
      >
        {isFailed ? <RefreshCw className="h-3.5 w-3.5" /> : <Download className="h-3.5 w-3.5" />}
        {isFailed ? 'Retry install' : 'Install'}
      </Button>
    );
  } else if (provider.updateAvailable) {
    primaryAction = (
      <Button variant="solid" size="sm" onClick={() => onInstall(provider.id)}>
        <Download className="h-3.5 w-3.5" />
        {provider.installError ? 'Retry update' : 'Update'}
      </Button>
    );
  } else if (hasConnectionError) {
    primaryAction = (
      <Button variant="outline" size="sm" onClick={() => onRefresh(provider.id)}>
        <RefreshCw className="h-3.5 w-3.5" />
        Retry connection
      </Button>
    );
  } else if (hasAuth && !isAuthed) {
    primaryAction = (
      <Button variant="solid" size="sm" onClick={() => onAuth(provider)}>
        <KeyRound className="h-3.5 w-3.5" />
        Authenticate
      </Button>
    );
  }

  return (
    <Card className="border-border/25 bg-surface-secondary/5 hover:border-border/40 flex flex-col gap-2 rounded-xl border p-3.5 transition-colors [&::before]:hidden">
      <div className="flex min-w-0 items-start gap-3">
        <ProviderIcon provider={provider} size="sm" className="mt-0.5 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
            <h3 className="text-text-main truncate text-[13px] font-semibold" title={providerId}>
              {name}
            </h3>
            {versionLabel && (
              <span className="text-text-muted font-mono text-[10.5px]">{versionLabel}</span>
            )}
          </div>
          <p
            className="text-text-muted mt-0.5 truncate text-[11px]"
            title={provider.description ?? undefined}
          >
            {provider.description ?? 'No description available'}
          </p>
          {(authStatus || isInstalling) && !downloadProgress && (
            <div className="text-text-muted mt-1 flex items-center gap-1.5 text-[10.5px]">
              {authStatus && (
                <span className={`h-1.5 w-1.5 rounded-full ${authStatus.className}`} />
              )}
              <span>
                {isInstalling ? `${provider.installStage ?? 'Installing'}…` : authStatus?.label}
              </span>
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {primaryAction}
          {showMenu && (
            <DropdownRoot>
              <DropdownTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`More actions for ${name}`}
                  className="h-8 w-8 rounded-lg p-0"
                >
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownTrigger>
              <DropdownContent align="end" className="min-w-40">
                {hasAuth && isInstalled && (
                  <DropdownItem onSelect={() => onAuth(provider)}>
                    <KeyRound className="mr-2 h-3.5 w-3.5" />
                    Configure
                  </DropdownItem>
                )}
                {hasConnectionError && provider.updateAvailable && (
                  <DropdownItem onSelect={() => onRefresh(provider.id)}>
                    <RefreshCw className="mr-2 h-3.5 w-3.5" />
                    Retry connection
                  </DropdownItem>
                )}
                {canLogout && (
                  <DropdownItem onSelect={() => onLogout(provider.id)}>
                    <LogOut className="mr-2 h-3.5 w-3.5" />
                    Log out
                  </DropdownItem>
                )}
                {repositoryUrl && (
                  <DropdownItem asChild>
                    <a href={repositoryUrl} target="_blank" rel="noopener noreferrer">
                      <GithubIcon className="mr-2 h-3.5 w-3.5" />
                      Repository
                    </a>
                  </DropdownItem>
                )}
                {websiteUrl && (
                  <DropdownItem asChild>
                    <a href={websiteUrl} target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="mr-2 h-3.5 w-3.5" />
                      Website
                    </a>
                  </DropdownItem>
                )}
                {isInstalled && (
                  <>
                    <DropdownSeparator />
                    <DropdownItem
                      disabled={isRemoving}
                      onSelect={() => onRemove(provider.id)}
                      className="text-red-400 focus-visible:text-red-300"
                    >
                      {isRemoving ? (
                        <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Trash2 className="mr-2 h-3.5 w-3.5" />
                      )}
                      Remove
                    </DropdownItem>
                  </>
                )}
              </DropdownContent>
            </DropdownRoot>
          )}
        </div>
      </div>

      {downloadProgress && (
        <div className="space-y-1.5">
          <div className="text-text-muted flex items-center justify-between gap-2 text-[10.5px]">
            <span>
              {downloadPercent === null ? 'Downloading' : `Downloading ${downloadPercent}%`}
            </span>
            <span className="font-mono">
              {formatMiB(downloadProgress.downloadedBytes)}
              {downloadProgress.totalBytes ? ` / ${formatMiB(downloadProgress.totalBytes)}` : ''}
            </span>
          </div>
          <div
            role="progressbar"
            aria-label={`${name} download`}
            aria-valuemin={0}
            aria-valuemax={downloadPercent === null ? undefined : 100}
            aria-valuenow={downloadPercent ?? undefined}
            className="bg-border/40 h-1.5 overflow-hidden rounded-full"
          >
            <div
              className={`bg-accent h-full rounded-full transition-all duration-300 ${downloadPercent === null ? 'w-1/3 animate-pulse' : ''}`}
              style={downloadPercent === null ? undefined : { width: `${downloadPercent}%` }}
            />
          </div>
        </div>
      )}

      {hasInstallError && (
        <details className="group rounded-lg border border-amber-500/20 bg-amber-500/8 px-2.5 py-1.5 text-[11px] text-amber-200">
          <summary className="flex cursor-pointer list-none items-center gap-1.5 [&::-webkit-details-marker]:hidden">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-400" />
            <span className="min-w-0 flex-1 truncate" title={errorText}>
              {isInstalled ? 'Update failed' : 'Install failed'}
              {errorText ? `: ${errorText}` : ''}
            </span>
            <ChevronDown className="h-3.5 w-3.5 shrink-0 transition-transform group-open:rotate-180" />
          </summary>
          <p className="mt-1.5 pl-5 font-mono text-[10.5px] break-words text-amber-200/80">
            {provider.installError}
            {isInstalled && currentVersion ? ` · v${currentVersion} remains active` : ''}
          </p>
        </details>
      )}

      {!hasInstallError && hasConnectionError && (
        <details className="group rounded-lg border border-amber-500/20 bg-amber-500/8 px-2.5 py-1.5 text-[11px] text-amber-200">
          <summary className="flex cursor-pointer list-none items-center gap-1.5 [&::-webkit-details-marker]:hidden">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-400" />
            <span className="min-w-0 flex-1 truncate">Connection failed</span>
            <ChevronDown className="h-3.5 w-3.5 shrink-0 transition-transform group-open:rotate-180" />
          </summary>
          <p className="mt-1.5 pl-5 font-mono text-[10.5px] break-words text-amber-200/80">
            {provider.authError?.message ?? 'The provider did not complete the ACP handshake.'}
          </p>
        </details>
      )}
    </Card>
  );
}
