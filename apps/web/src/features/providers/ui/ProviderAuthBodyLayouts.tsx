import type { ReactNode } from 'react';
import type { ProviderDiscovery } from '@agentctl/shared';

export function providerAuthMethods(provider: ProviderDiscovery) {
  return (provider.agent?.authMethods ?? provider.authMethods ?? []).filter(
    (method) => method.type !== 'env_var',
  );
}

export function providerAuthConnectionCopy(provider: ProviderDiscovery) {
  const authenticated = provider.authState === 'authenticated';
  return {
    title: authenticated ? 'Authenticated & Connected' : 'Connected',
    description: provider.lastVerifiedAt
      ? `Last verified at ${new Date(provider.lastVerifiedAt).toLocaleTimeString()}`
      : authenticated
        ? 'Credentials verified.'
        : 'This provider does not require authentication.',
  };
}

export function AuthCancelLayout({
  children,
  onSelect,
}: {
  children: ReactNode;
  onSelect?: () => void;
}) {
  const Action = onSelect ? 'button' : 'span';
  return (
    <Action
      type={onSelect ? 'button' : undefined}
      onClick={onSelect}
      className="border-border/50 text-text-muted hover:text-text-main hover:bg-surface-secondary mt-2 flex h-7 items-center rounded-lg border px-3 text-xs"
    >
      {children}
    </Action>
  );
}

export function ProviderAuthBodyLayout({ children }: { children: ReactNode }) {
  return <div className="mt-3 flex flex-col gap-4 font-sans text-xs">{children}</div>;
}

const AUTH_STATUS_COPY = {
  verifying: {
    title: 'Verifying connection…',
    description: 'Agentctl is performing a handshake probe to verify credentials.',
  },
  authenticating: {
    title: 'Waiting for agent authentication…',
    description: 'Complete the prompt in your browser or agent window if prompted.',
  },
};

export function AuthStatusLayout({
  phase,
  icon,
  actions,
  announce = false,
}: {
  phase: keyof typeof AUTH_STATUS_COPY;
  icon: ReactNode;
  actions?: ReactNode;
  announce?: boolean;
}) {
  const copy = AUTH_STATUS_COPY[phase];
  return (
    <div
      role={announce ? 'status' : undefined}
      aria-live={announce ? 'polite' : undefined}
      className="border-border/40 bg-surface/30 flex flex-col items-center justify-center gap-3 rounded-xl border p-6 text-center"
    >
      {icon}
      <div className="space-y-1">
        <p className="text-text-main text-xs font-semibold">{copy.title}</p>
        <p className="text-text-muted text-[11px]">{copy.description}</p>
      </div>
      {actions}
    </div>
  );
}

export function AuthMethodsLayout({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-2.5">{children}</div>;
}

export function AuthEmptyActionLayout({
  children,
  onSelect,
}: {
  children: ReactNode;
  onSelect?: () => void;
}) {
  const Action = onSelect ? 'button' : 'span';
  return (
    <Action
      type={onSelect ? 'button' : undefined}
      onClick={onSelect}
      className="bg-accent text-brand-crust flex h-8 items-center rounded-lg px-4 text-xs font-semibold hover:opacity-90"
    >
      {children}
    </Action>
  );
}

export function AuthMethodLayout({
  primary,
  icon,
  title,
  description,
  onSelect,
}: {
  primary: boolean;
  icon: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  onSelect?: () => void;
}) {
  const Action = onSelect ? 'button' : 'div';
  return (
    <Action
      type={onSelect ? 'button' : undefined}
      onClick={onSelect}
      className={`flex min-h-12 w-full items-center rounded-xl px-4 py-2 text-left text-xs font-medium transition-colors ${primary ? 'bg-accent text-brand-crust font-semibold shadow hover:opacity-90 active:scale-[0.99]' : 'border-border/50 bg-surface-secondary/40 text-text-main hover:bg-surface-secondary/80 border'}`}
    >
      <div className="flex min-w-0 items-center gap-2.5">
        {icon}
        <span className="flex min-w-0 flex-col gap-0.5">
          <span>{title}</span>
          {description && <span className="text-[10px] font-normal opacity-75">{description}</span>}
        </span>
      </div>
    </Action>
  );
}

export function AuthEmptyMethodsLayout({
  description,
  action,
}: {
  description: ReactNode;
  action: ReactNode;
}) {
  return (
    <div className="border-border/30 bg-surface/20 flex flex-col items-center justify-center gap-2 rounded-xl border p-5 text-center">
      <p className="text-text-muted text-xs">{description}</p>
      {action}
    </div>
  );
}

export function AuthConnectionLayout({
  icon,
  title,
  description,
  actions,
}: {
  icon: ReactNode;
  title: ReactNode;
  description: ReactNode;
  actions: ReactNode;
}) {
  return (
    <div className="border-border/40 bg-surface/30 flex flex-col gap-3 rounded-xl border p-4">
      <div className="flex items-center gap-3">
        <div className="bg-success/15 text-success flex h-7 w-7 items-center justify-center rounded-full">
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-text-main font-semibold">{title}</p>
          <p className="text-text-muted text-[11px]">{description}</p>
        </div>
      </div>
      <div className="border-border/20 flex items-center justify-between border-t pt-3">
        {actions}
      </div>
    </div>
  );
}

export function AuthEnvironmentLayout({
  heading,
  summary,
  onToggle,
  children,
}: {
  heading: ReactNode;
  summary: ReactNode;
  onToggle?: () => void;
  children?: ReactNode;
}) {
  const Toggle = onToggle ? 'button' : 'div';
  return (
    <div className="border-border/20 border-t pt-3">
      <Toggle
        type={onToggle ? 'button' : undefined}
        onClick={onToggle}
        className="text-text-muted hover:text-text-main flex w-full items-center justify-between py-1 text-[11px] font-medium transition-colors"
      >
        <span className="flex items-center gap-1.5">{heading}</span>
        <span className="text-[10px] opacity-70">{summary}</span>
      </Toggle>
      {children}
    </div>
  );
}
