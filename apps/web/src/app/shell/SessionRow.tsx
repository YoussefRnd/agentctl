import { SidebarSessionRowLayout } from './SidebarRowLayouts';
import { useState } from 'react';
import { getSessionDisplayTitle, type ProviderDiscovery } from '@agentctl/shared';
import { Link } from 'react-router-dom';
import {
  Trash2,
  Archive,
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
  CheckCheck,
  RotateCcw,
  GitBranch,
  GitFork,
} from 'lucide-react';
import type { SidebarProject } from '@agentctl/api-client';
import { Dropdown, IconButton, Tooltip, Spinner } from '@agentctl/ui';
import { RelativeTime } from '@/shared';
import { ProviderIconUrl, getProviderIconUrl } from '@/shared/ui/ProviderIcon';
import { prefetchSessionNavigation } from '@/features/sessions';
import { useQueryClient } from '@tanstack/react-query';
import { sessionActivity } from './model/sessionActivity';

export interface SessionRowProps {
  session: SidebarProject['sessions'][number];
  isActive: boolean;
  isPending: boolean;
  provider?: ProviderDiscovery;
  onPin: (id: string, pinned: boolean) => void;
  onSettle: (id: string, settled: boolean) => void;
  onRename: (id: string, title: string) => void;
  onFork: (id: string, title: string) => void;
  onArchive: (id: string, title: string) => void;
  onDelete: (id: string, title: string) => void;
}

export function SessionRow(props: SessionRowProps) {
  const queryClient = useQueryClient();
  const prefetch = () => {
    if (!props.isActive) void prefetchSessionNavigation(queryClient, props.session.id);
  };
  return <SessionRowPresentation {...props} prefetch={prefetch} />;
}

export function SessionRowPresentation({
  session: s,
  prefetch = () => undefined,
  isActive,
  isPending,
  provider,
  onPin,
  onSettle,
  onRename,
  onFork,
  onArchive,
  onDelete,
}: SessionRowProps & { prefetch?: () => void }) {
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const sessionTitle = getSessionDisplayTitle(s);
  const activityTime = s.lastActivityAt;
  const unread = (s.latestActivityEventId ?? 0) > (s.lastReadEventId ?? 0);
  const activity = sessionActivity(s, unread);
  const providerName = provider?.label ?? s.selectedProvider;
  const providerIcon = provider ? getProviderIconUrl(provider) : undefined;

  return (
    <SidebarSessionRowLayout
      title={sessionTitle}
      detail={
        <>
          <Tooltip
            content={`${providerName}${s.selectedModel && s.selectedModel !== 'default' ? ` · ${s.selectedModel}` : ''}`}
          >
            <span
              className="bg-text-muted text-background inline-flex shrink-0 items-center rounded-md p-0.5"
              aria-label={providerName}
            >
              <ProviderIconUrl url={providerIcon ?? null} size="inline" />
            </span>
          </Tooltip>
          <span
            className="flex min-w-0 flex-1 basis-12 items-center gap-1"
            title={`${s.mode === 'worktree' ? 'Worktree' : 'Local workspace'}: ${s.worktreePath}${s.branch ? ` · ${s.branch}` : ''}`}
          >
            {s.mode === 'worktree' ? (
              <GitFork className="icon-inline shrink-0" />
            ) : s.branch ? (
              <GitBranch className="icon-inline shrink-0" />
            ) : null}
            <span className="truncate font-mono">
              {s.branch || (s.mode === 'worktree' ? 'Worktree' : 'Local workspace')}
            </span>
          </span>
          {activity && (
            <span
              className={`text-role-caption ml-auto inline-flex shrink-0 items-center gap-1 ${activity.color}`}
            >
              {activity.spinning && <Spinner className="icon-inline" aria-hidden="true" />}
              <span>{activity.label}</span>
            </span>
          )}
        </>
      }
      time={
        <RelativeTime
          value={activityTime}
          className={`text-role-caption text-text-muted text-right whitespace-nowrap tabular-nums ${isDropdownOpen ? 'invisible' : 'group-focus-within/session:invisible group-hover/session:invisible [@media(hover:none)]:invisible'}`}
        />
      }
      pin={
        <>
          {s.pinnedAt && (
            <Pin className="icon-inline text-text-muted shrink-0" aria-label="Pinned" />
          )}
        </>
      }
      unread={unread}
      dimmed={s.status === 'archived'}
      active={isActive}
      actions={
        <>
          {/* Keep actions above the full-row link without nesting a button inside it. */}
          <div
            className={`pointer-events-none absolute top-1 right-2 flex opacity-0 transition-opacity duration-150 group-focus-within/session:pointer-events-auto group-focus-within/session:opacity-100 group-hover/session:pointer-events-auto group-hover/session:opacity-100 [@media(hover:none)]:pointer-events-auto [@media(hover:none)]:opacity-100 ${
              isDropdownOpen ? 'pointer-events-auto opacity-100' : ''
            }`}
          >
            <Dropdown.Root open={isDropdownOpen} onOpenChange={setIsDropdownOpen}>
              <Dropdown.Trigger asChild>
                <IconButton
                  type="button"
                  size="compact"
                  aria-label="Session options"
                  disabled={isPending}
                  isLoading={isPending}
                  className="motion-disclosure active:transform-none active:opacity-100"
                >
                  <MoreHorizontal className="icon-compact" />
                </IconButton>
              </Dropdown.Trigger>
              <Dropdown.Portal>
                <Dropdown.Content align="end" className="w-40">
                  <Dropdown.Item onSelect={() => onPin(s.id, !s.pinnedAt)} className="gap-2">
                    {s.pinnedAt ? (
                      <PinOff className="icon-compact" />
                    ) : (
                      <Pin className="icon-compact" />
                    )}
                    <span>{s.pinnedAt ? 'Unpin session' : 'Pin session'}</span>
                  </Dropdown.Item>
                  {s.status !== 'archived' && (
                    <Dropdown.Item
                      disabled={!s.settledAt && ['running', 'needs_attention'].includes(s.status)}
                      onSelect={() => onSettle(s.id, !s.settledAt)}
                      className="gap-2 data-[disabled]:opacity-40"
                    >
                      {s.settledAt ? (
                        <RotateCcw className="icon-compact" />
                      ) : (
                        <CheckCheck className="icon-compact" />
                      )}
                      <span>{s.settledAt ? 'Reopen session' : 'Settle session'}</span>
                    </Dropdown.Item>
                  )}
                  <Dropdown.Item
                    onSelect={() => {
                      onRename(s.id, sessionTitle);
                    }}
                    className="gap-2"
                  >
                    <Pencil className="icon-compact" />
                    <span>Rename</span>
                  </Dropdown.Item>

                  <Dropdown.Item
                    onSelect={() => {
                      onFork(s.id, sessionTitle);
                    }}
                    className="gap-2"
                  >
                    <GitFork className="icon-compact" />
                    <span>Fork session</span>
                  </Dropdown.Item>

                  {s.status !== 'archived' && (
                    <Dropdown.Item
                      onSelect={() => {
                        onArchive(s.id, sessionTitle);
                      }}
                      className="text-warning hover:text-warning focus:text-warning gap-2"
                    >
                      <Archive className="icon-compact" />
                      <span>Archive</span>
                    </Dropdown.Item>
                  )}

                  <Dropdown.Item
                    onSelect={() => {
                      onDelete(s.id, sessionTitle);
                    }}
                    className="text-danger hover:text-danger focus:text-danger gap-2"
                  >
                    <Trash2 className="icon-compact" />
                    <span>Delete</span>
                  </Dropdown.Item>
                </Dropdown.Content>
              </Dropdown.Portal>
            </Dropdown.Root>
          </div>
        </>
      }
      renderBody={(content, className) => (
        <Link
          to={`/sessions/${s.id}`}
          onMouseEnter={prefetch}
          onFocus={prefetch}
          aria-current={isActive ? 'page' : undefined}
          className={className}
        >
          {content}
        </Link>
      )}
    />
  );
}
