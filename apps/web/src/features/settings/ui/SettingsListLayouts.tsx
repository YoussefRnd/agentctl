import type { ReactNode } from 'react';
import { Card } from '@agentctl/ui';

const SETTINGS_PAGES = {
  providers: {
    title: 'AI Providers',
    description:
      'Configure agent providers, authentication keys, and model parameters. Installed provider packages update automatically in the background.',
  },
  mcp: {
    title: 'MCP Servers',
    description: 'Connect local and remote Model Context Protocol tools to extend your agents.',
  },
};

export function SettingsListLayout({
  section,
  actions,
  children,
}: {
  section: keyof typeof SETTINGS_PAGES;
  actions: ReactNode;
  children: ReactNode;
}) {
  const page = SETTINGS_PAGES[section];
  return (
    <div className="space-y-6">
      <div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-text-main text-lg leading-8 font-bold">{page.title}</h2>
          <div className="flex min-w-0 flex-wrap items-center gap-2">{actions}</div>
        </div>
        <p className="text-text-muted mt-1 text-xs">{page.description}</p>
      </div>
      {children}
    </div>
  );
}

export function RegistryCardLayout({
  icon,
  title,
  titleHint,
  version,
  description,
  descriptionHint,
  status,
  actions,
  children,
}: {
  icon: ReactNode;
  title: ReactNode;
  titleHint?: string;
  version?: ReactNode;
  description: ReactNode;
  descriptionHint?: string;
  status?: ReactNode;
  actions: ReactNode;
  children?: ReactNode;
}) {
  return (
    <Card className="border-border/25 bg-surface-secondary/5 hover:border-border/40 flex flex-col gap-2 rounded-lg border p-3.5 transition-colors [&::before]:hidden">
      <div className="flex min-w-0 flex-wrap items-start gap-3">
        {icon}
        <div className="min-w-0 flex-1 basis-32 [overflow-wrap:anywhere]">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
            <h3 className="text-text-main truncate text-[13px] font-semibold" title={titleHint}>
              {title}
            </h3>
            {version && <span className="text-text-muted font-mono text-[10.5px]">{version}</span>}
          </div>
          <p className="text-text-muted mt-0.5 truncate text-[11px]" title={descriptionHint}>
            {description}
          </p>
          {status}
        </div>
        <div className="flex shrink-0 items-center gap-1">{actions}</div>
      </div>
      {children}
    </Card>
  );
}

export function McpServerCardLayout({
  icon,
  title,
  detail,
  actions,
  onToggleExpand,
  expanded,
  controlsId,
  summaryTitle,
  children,
}: {
  icon: ReactNode;
  title: ReactNode;
  detail?: ReactNode;
  actions: ReactNode;
  onToggleExpand?: () => void;
  expanded?: boolean;
  controlsId?: string;
  summaryTitle?: string;
  children?: ReactNode;
}) {
  const Summary = onToggleExpand ? 'button' : 'div';
  return (
    <Card className="group border-border/20 hover:border-accent/20 overflow-hidden border transition-colors">
      <div className="flex w-full min-w-0 flex-wrap items-center justify-between gap-3 p-4">
        <Summary
          type={onToggleExpand ? 'button' : undefined}
          onClick={onToggleExpand}
          aria-expanded={onToggleExpand ? expanded : undefined}
          aria-controls={controlsId}
          title={summaryTitle}
          className="focus-visible:ring-accent/40 flex min-w-0 flex-1 basis-48 cursor-pointer items-center gap-3.5 rounded-md border-none bg-transparent text-left select-none focus-visible:ring-2 focus-visible:outline-none"
        >
          <div className="border-border/30 bg-surface-secondary/40 group-hover:bg-surface-secondary/60 text-text-main flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border p-1.5 transition-colors">
            {icon}
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-role-title text-text-main flex min-w-0 flex-wrap items-center gap-2">
              {title}
            </h3>
            {detail && <div className="mt-1.5 flex flex-wrap items-center gap-1.5">{detail}</div>}
          </div>
        </Summary>
        <div className="ml-auto flex shrink-0 items-center gap-3">{actions}</div>
      </div>
      {children}
    </Card>
  );
}

export function McpToolDiscoveryHint() {
  return (
    <span className="text-text-muted text-[9.5px] italic opacity-40">Discovering tools...</span>
  );
}

export function SetupProviderRowLayout({
  icon,
  title,
  status,
  children,
}: {
  icon: ReactNode;
  title: ReactNode;
  status: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="bg-surface-secondary/20 border-border/10 hover:border-border/30 animate-in fade-in flex flex-col gap-2.5 rounded-xl border p-3 transition-colors">
      <div className="flex items-center justify-between">
        <div className="flex min-w-0 items-center gap-2.5">
          {icon}
          <div className="min-w-0">
            <div className="text-text-main truncate text-xs font-semibold">{title}</div>
            <div className="text-text-muted mt-0.5 text-[10px] font-medium opacity-60">
              {status}
            </div>
          </div>
        </div>
      </div>
      {children}
    </div>
  );
}

export function ProviderProfilesLayout({
  selector,
  children,
}: {
  selector: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="border-border/40 space-y-3 rounded-xl border p-4">
      <p className="text-sm font-semibold">Provider profiles</p>
      <p className="text-text-muted text-xs">
        Create named profiles with separate credentials and defaults. Profiles share the installed
        agent. For agents using a global login, configure a separate account directory through their
        environment settings below.
      </p>
      {selector}
      {children}
    </div>
  );
}

export function RegistryToolbarLayout({
  search,
  filters,
}: {
  search: ReactNode;
  filters: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 flex-1">{search}</div>
      <div className="max-w-full shrink-0">{filters}</div>
    </div>
  );
}
export function RegistryCardsLayout({ children }: { children: ReactNode }) {
  return <div className="grid gap-3">{children}</div>;
}
export function McpCardsLayout({ children }: { children: ReactNode }) {
  return <div className="space-y-3">{children}</div>;
}
