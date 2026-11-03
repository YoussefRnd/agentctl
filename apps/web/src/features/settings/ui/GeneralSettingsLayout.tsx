import type { ReactNode } from 'react';
import { Card, cn } from '@agentctl/ui';

export interface GeneralSettingsSlots {
  themeMode: ReactNode;
  lightTheme?: ReactNode;
  darkTheme?: ReactNode;
  defaultProvider: ReactNode;
  notifications: ReactNode;
  showThinking: ReactNode;
  defaultToWorktree: ReactNode;
  notifyOnCompletion: ReactNode;
  notifyOnAttention: ReactNode;
  gitGeneration: ReactNode;
  typography: ReactNode;
  updates: ReactNode;
  notificationBadge?: ReactNode;
}

/** Shared presentation only: live controls and loading placeholders occupy the same slots. */
export function GeneralSettingsLayout({
  slots,
  themeMode,
}: {
  slots: GeneralSettingsSlots;
  themeMode: 'light' | 'dark' | 'system';
}) {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-text-main pr-10 text-lg leading-8 font-bold">General Settings</h2>
        <p className="text-text-muted mt-1 text-xs">
          Manage your application appearance, agent behavior, and typography.
        </p>
      </div>

      {/* Appearance Section */}
      <div className="space-y-2.5">
        <h3 className="text-text-muted px-1 text-[11px] font-bold tracking-wider uppercase">
          Appearance
        </h3>
        <Card className="divide-border/30 divide-y overflow-hidden px-5 py-2">
          {/* Theme Mode Segmented Control */}
          <div className="flex flex-col gap-2 py-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
            <div>
              <p className="text-text-main text-[13px] font-semibold">Theme Mode</p>
              <p className="text-text-muted mt-0.5 text-[11px]">
                {themeMode === 'system'
                  ? 'Automatically match your operating system theme'
                  : themeMode === 'light'
                    ? 'Always use light theme appearance'
                    : 'Always use dark theme appearance'}
              </p>
            </div>
            {slots.themeMode}
          </div>

          {/* Light Theme Select */}
          {themeMode !== 'dark' && (
            <div className="flex flex-col gap-2 py-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
              <div>
                <p className="text-text-main text-[13px] font-semibold">Light Theme</p>
                <p className="text-text-muted mt-0.5 text-[11px]">
                  Color scheme used for light mode
                </p>
              </div>
              {slots.lightTheme}
            </div>
          )}

          {/* Dark Theme Select */}
          {themeMode !== 'light' && (
            <div className="flex flex-col gap-2 py-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
              <div>
                <p className="text-text-main text-[13px] font-semibold">Dark Theme</p>
                <p className="text-text-muted mt-0.5 text-[11px]">
                  Color scheme used for dark mode
                </p>
              </div>
              {slots.darkTheme}
            </div>
          )}
        </Card>
      </div>

      {/* Agent Defaults Section */}
      <div className="space-y-2.5">
        <h3 className="text-text-muted px-1 text-[11px] font-bold tracking-wider uppercase">
          Agent Defaults
        </h3>
        <Card className="divide-border/30 divide-y overflow-hidden px-5 py-2">
          {/* Default Provider */}
          <div className="flex flex-col gap-2 py-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
            <div>
              <p className="text-text-main text-[13px] font-semibold">Default Agent Provider</p>
              <p className="text-text-muted mt-0.5 text-[11px]">
                Fallback provider pre-selected when creating new sessions
              </p>
            </div>
            <div className="w-52 max-w-full">{slots.defaultProvider}</div>
          </div>

          {/* Show Thinking */}
          <div className="flex items-center justify-between gap-3 py-3">
            <div>
              <p className="text-text-main text-[13px] font-semibold">Auto-Expand Thinking</p>
              <p className="text-text-muted mt-0.5 text-[11px]">
                Automatically show reasoning thought streams while the agent is generating
              </p>
            </div>
            {slots.showThinking}
          </div>
        </Card>
      </div>

      {slots.gitGeneration}

      {/* Workspace Defaults Section */}
      <div className="space-y-2.5">
        <h3 className="text-text-muted px-1 text-[11px] font-bold tracking-wider uppercase">
          Workspace Defaults
        </h3>
        <Card className="divide-border/30 divide-y overflow-hidden px-5 py-2">
          <div className="flex items-center justify-between gap-3 py-3">
            <div>
              <p className="text-text-main text-[13px] font-semibold">
                Use Git Worktrees by Default
              </p>
              <p className="text-text-muted mt-0.5 text-[11px]">
                Create new sessions in isolated Git worktrees so multiple agents can work
                concurrently without branch conflicts
              </p>
            </div>
            {slots.defaultToWorktree}
          </div>
        </Card>
      </div>

      {/* Typography Section */}
      <div className="space-y-2.5">
        <h3 className="text-text-muted px-1 text-[11px] font-bold tracking-wider uppercase">
          Typography
        </h3>
        {slots.typography}
      </div>

      {/* Notifications Section */}
      <div className="space-y-2.5">
        <h3 className="text-text-muted px-1 text-[11px] font-bold tracking-wider uppercase">
          Notifications
        </h3>
        <Card className="divide-border/30 divide-y overflow-hidden px-5 py-2">
          {/* Master Notifications Switch */}
          <div className="flex items-center justify-between gap-3 py-3">
            <div>
              <div className="flex items-center gap-2">
                <p className="text-text-main text-[13px] font-semibold">Desktop Notifications</p>
                {slots.notificationBadge}
              </div>
              <p className="text-text-muted mt-0.5 text-[11px]">
                Receive OS notifications when agentctl is in the background or unfocused
              </p>
            </div>
            {slots.notifications}
          </div>

          {/* Turn Completion */}
          <div className="flex items-center justify-between gap-3 py-3">
            <div>
              <p className="text-text-main text-[13px] font-semibold">Notify on Turn Completion</p>
              <p className="text-text-muted mt-0.5 text-[11px]">
                Alert when a prompt turn finishes running and becomes idle
              </p>
            </div>
            {slots.notifyOnCompletion}
          </div>

          {/* Attention Required */}
          <div className="flex items-center justify-between gap-3 py-3">
            <div>
              <p className="text-text-main text-[13px] font-semibold">
                Notify on Review & Approval Needed
              </p>
              <p className="text-text-muted mt-0.5 text-[11px]">
                Alert when the agent requires permission to run a tool or needs your approval
              </p>
            </div>
            {slots.notifyOnAttention}
          </div>
        </Card>
      </div>

      {/* Updates Section */}
      <div className="space-y-2.5">
        <h3 className="text-text-muted px-1 text-[11px] font-bold tracking-wider uppercase">
          Software Updates
        </h3>
        {slots.updates}
      </div>
    </div>
  );
}

export function GitGenerationSettingsLayout({
  provider,
  model,
  children,
}: {
  provider: ReactNode;
  model: ReactNode;
  children?: ReactNode;
}) {
  return (
    <section className="space-y-2.5" aria-labelledby="git-generation-heading">
      <h3
        id="git-generation-heading"
        className="text-text-muted px-1 text-[11px] font-bold tracking-wider uppercase"
      >
        Git text generation
      </h3>
      <Card className="space-y-4 px-5 py-4">
        <p className="text-text-muted text-xs">
          Choose the LLM for commit messages, merge messages, and PR titles and descriptions. This
          setting applies to all projects.
        </p>
        <div className="grid min-w-0 gap-4 sm:grid-cols-2">
          <div className="min-w-0 space-y-1.5">
            <label
              htmlFor="git-generation-provider"
              className="text-text-main text-xs font-semibold"
            >
              Provider
            </label>
            {provider}
          </div>
          <div className="min-w-0 space-y-1.5">
            <label htmlFor="git-generation-model" className="text-text-main text-xs font-semibold">
              Model
            </label>
            {model}
          </div>
        </div>
        {children}
      </Card>
    </section>
  );
}

export function UpdateSettingsLayout({
  version,
  action,
  children,
}: {
  version: ReactNode;
  action: ReactNode;
  children?: ReactNode;
}) {
  return (
    <Card className="hover:border-accent/20 flex flex-col gap-3 px-5 py-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-text-main text-[13px] font-bold tracking-tight">Updates</p>
          <p className="text-text-muted mt-0.5 text-[11px] leading-normal opacity-85">{version}</p>
        </div>
        {action}
      </div>

      {children}
    </Card>
  );
}

export const FONT_CONTEXTS = [
  { key: 'ui', label: 'UI & Text', desc: 'Interface, sidebar, tabs, and chat messages' },
  { key: 'code', label: 'Code & Terminal', desc: 'Code blocks, diffs, and interactive terminal' },
] as const;
export function FontSettingsLayout({
  children,
  footer,
}: {
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <Card className="px-5 py-4">
      {children}
      {footer}
    </Card>
  );
}
export function FontSettingsRow({
  rowKey,
  index,
  label,
  description,
  reset,
  picker,
  size,
}: {
  rowKey: string;
  index: number;
  label: ReactNode;
  description: ReactNode;
  reset?: ReactNode;
  picker: ReactNode;
  size: ReactNode;
}) {
  return (
    <div
      data-font-ctx={rowKey}
      className={cn(
        'flex flex-col gap-2 py-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-4',
        index < FONT_CONTEXTS.length - 1 && 'border-border/30 border-b',
      )}
    >
      <div className="w-44 max-w-full shrink-0">
        <div className="flex items-center gap-1">
          <span className="text-text-main text-[12px] font-bold">{label}</span>
          {reset}
        </div>
        <p className="text-text-muted/70 text-[10px]">{description}</p>
      </div>
      <div className="max-w-xs min-w-0 flex-1">{picker}</div>
      {size}
    </div>
  );
}
