import { resolveAgentFeatures, type ProviderDiscovery } from '@agentctl/shared';
import {
  Download,
  Trash2,
  KeyRound,
  Loader2,
  ExternalLink,
  LogOut,
  AlertTriangle,
  RefreshCw,
} from 'lucide-react';
import { ProviderIcon } from '@/shared';
import { Card, Button } from '@agentctl/ui';

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
  onRemove: (id: string) => void;
  onAuth: (provider: ProviderDiscovery) => void;
  onLogout: (id: string) => void;
  isInstalling: boolean;
  isRemoving: boolean;
}

const authStateConfig: Record<string, { label: string; className: string }> = {
  authenticated: { label: 'Authenticated', className: 'text-emerald-400 bg-emerald-500/10' },
  needs_auth: { label: 'Auth Required', className: 'text-amber-400 bg-amber-500/10' },
  error: { label: 'Error', className: 'text-red-400 bg-red-500/10' },
  unknown: { label: 'Not Authenticated', className: 'text-slate-400 bg-slate-500/10' },
};

export function RegistryCard({
  provider,
  onInstall,
  onRemove,
  onAuth,
  onLogout,
  isInstalling: isInstallingProp,
  isRemoving,
}: RegistryCardProps) {
  const name = provider.agent?.name ?? provider.label;
  const subtitle = provider.agent?.id ?? provider.id;
  const isInstalled =
    provider.installState === 'installed_local' || provider.installState === 'system_available';
  const isInstalling = isInstallingProp || provider.installState === 'installing';
  const isFailed = provider.installState === 'failed';
  const repositoryUrl = provider.agent?.repository;
  const websiteUrl = provider.agent?.website;
  const hasAuth = !!provider.agent?.authMethods && provider.agent.authMethods.length > 0;
  const authStatus =
    hasAuth && provider.authState ? authStateConfig[provider.authState] : undefined;

  return (
    <Card className="border-border/20 bg-surface-secondary/5 hover:border-border/35 hover:bg-surface-secondary/10 flex flex-col gap-2.5 rounded-xl border p-4 transition-colors duration-200 [&::before]:hidden">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <ProviderIcon provider={provider} size="sm" className="shrink-0" />
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <h3 className="text-text-main text-[13.5px] font-bold tracking-tight">{name}</h3>
            <span className="text-text-muted font-mono text-[10.5px] opacity-70">
              v{provider.version ?? '0.0.1'}
            </span>
            {isFailed && (
              <span className="rounded-md bg-red-500/10 px-2 py-0.5 text-[9.5px] font-bold tracking-wider text-red-400 uppercase">
                Install Failed
              </span>
            )}
            {authStatus && isInstalled && (
              <span
                className={`rounded-md px-2 py-0.5 text-[9.5px] font-bold tracking-wider uppercase ${authStatus.className}`}
              >
                {authStatus.label}
              </span>
            )}
          </div>
        </div>

        <div className="flex shrink-0 items-center self-start sm:self-auto">
          <RegistryCardActions
            provider={provider}
            onInstall={onInstall}
            onRemove={onRemove}
            onAuth={onAuth}
            onLogout={onLogout}
            isInstalling={isInstalling}
            isRemoving={isRemoving}
          />
        </div>
      </div>

      <p className="text-text-muted text-[11px] leading-relaxed opacity-85">
        {provider.description ?? 'No description available for this agent provider.'}
      </p>

      {isFailed && provider.installError && (
        <div className="rounded-lg border border-red-500/20 bg-red-500/10 p-2.5 text-[11px] text-red-300">
          <div className="flex items-center gap-1.5 font-semibold text-red-400">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            Installation Failed
          </div>
          <p className="mt-1 font-mono text-[10.5px] break-words whitespace-pre-wrap text-red-300/90">
            {provider.installError}
          </p>
        </div>
      )}

      <div className="text-text-muted mt-1 flex items-center justify-end gap-2 text-[10.5px] opacity-70">
        <span className="font-mono">ID: {subtitle}</span>

        {repositoryUrl && (
          <a
            href={repositoryUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-text-main ml-1 p-0.5 transition-colors"
            title="Repository"
          >
            <GithubIcon className="h-3.5 w-3.5" />
          </a>
        )}

        {websiteUrl && (
          <a
            href={websiteUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-text-main p-0.5 transition-colors"
            title="Website"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        )}
      </div>
    </Card>
  );
}

function InstallButton({
  isInstalling,
  isFailed,
  onClick,
}: {
  isInstalling: boolean;
  isFailed: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      variant={isFailed ? 'solid' : 'outline'}
      size="sm"
      disabled={isInstalling}
      onClick={onClick}
      className={`flex h-8 items-center gap-1 rounded-lg px-3 py-1.5 text-[10.5px] font-bold tracking-wide uppercase ${
        isFailed ? 'bg-red-500/20 text-red-300 hover:bg-red-500/30' : ''
      }`}
    >
      {isInstalling ? (
        <Loader2 className="h-3 w-3 animate-spin" />
      ) : isFailed ? (
        <RefreshCw className="h-3 w-3" />
      ) : (
        <Download className="h-3 w-3" />
      )}
      {isInstalling ? 'Installing...' : isFailed ? 'Retry' : 'Install'}
    </Button>
  );
}

function RemoveButton({ isRemoving, onClick }: { isRemoving: boolean; onClick: () => void }) {
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={isRemoving}
      onClick={onClick}
      className="flex h-8 items-center gap-1 rounded-lg border-red-500/10 px-3 py-1.5 text-[10.5px] font-bold tracking-wide text-red-400 uppercase hover:bg-red-500/5 hover:text-red-300"
    >
      {isRemoving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
      Remove
    </Button>
  );
}

function RegistryCardActions({
  provider,
  onInstall,
  onRemove,
  onAuth,
  onLogout,
  isInstalling,
  isRemoving,
}: {
  provider: ProviderDiscovery;
  onInstall: (id: string) => void;
  onRemove: (id: string) => void;
  onAuth: (provider: ProviderDiscovery) => void;
  onLogout: (id: string) => void;
  isInstalling: boolean;
  isRemoving: boolean;
}) {
  const isInstalled =
    provider.installState === 'installed_local' || provider.installState === 'system_available';
  const isFailed = provider.installState === 'failed';
  const hasAuth =
    (provider.agent?.authMethods && provider.agent.authMethods.length > 0) ||
    (provider.authMethods && provider.authMethods.length > 0);
  const isAuthed = provider.authState === 'authenticated';
  const canLogout = resolveAgentFeatures(provider).authentication.logout && isAuthed;

  return (
    <div className="flex shrink-0 items-center gap-1.5">
      {canLogout && (
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            onLogout(provider.id);
          }}
          className="flex h-8 items-center gap-1 rounded-lg px-3 py-1.5 text-[10.5px] font-bold tracking-wide uppercase"
        >
          <LogOut className="h-3 w-3" />
          Logout
        </Button>
      )}

      {hasAuth && isInstalled && (
        <Button
          variant={isAuthed ? 'outline' : 'solid'}
          size="sm"
          onClick={() => {
            onAuth(provider);
          }}
          className={`flex h-8 items-center gap-1.5 rounded-lg px-3 py-1.5 text-[10.5px] font-bold tracking-wide uppercase ${
            !isAuthed ? 'bg-accent text-brand-crust hover:opacity-90' : ''
          }`}
        >
          <KeyRound className="h-3 w-3" />
          {isAuthed ? 'Configure' : 'Authenticate'}
        </Button>
      )}

      {isInstalled ? (
        <RemoveButton isRemoving={isRemoving} onClick={() => onRemove(provider.id)} />
      ) : (
        <InstallButton
          isInstalling={isInstalling}
          isFailed={isFailed}
          onClick={() => onInstall(provider.id)}
        />
      )}
    </div>
  );
}
