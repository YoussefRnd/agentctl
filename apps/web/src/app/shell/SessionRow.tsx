import { useState } from 'react';
import { getSessionDisplayTitle, type ProviderDiscovery } from '@agentctl/shared';
import { Link } from 'react-router-dom';
import {
  Loader2,
  Trash2,
  Archive,
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
  GitBranch,
  GitFork,
} from 'lucide-react';
import type { SidebarProject } from '@agentctl/api-client';
import { Dropdown, IconButton, Tooltip } from '@agentctl/ui';
import { RelativeTime } from '@/shared';
import { ProviderIconUrl, getProviderIconUrl } from '@/shared/ui/ProviderIcon';
import { prefetchSessionNavigation } from '@/features/sessions';
import { useQueryClient } from '@tanstack/react-query';
import { sessionActivity } from './model/sessionActivity';

interface SessionRowProps {
  session: SidebarProject['sessions'][number];
  isActive: boolean;
  isPending: boolean;
  provider?: ProviderDiscovery;
  onPin: (id: string, pinned: boolean) => void;
  onRename: (id: string, title: string) => void;
  onFork: (id: string, title: string) => void;
  onArchive: (id: string, title: string) => void;
  onDelete: (id: string, title: string) => void;
}

export function SessionRow({
  session: s,
  isActive,
  isPending,
  provider,
  onPin,
  onRename,
  onFork,
  onArchive,
  onDelete,
}: SessionRowProps) {
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const queryClient = useQueryClient();
  const prefetch = () => {
    if (!isActive) void prefetchSessionNavigation(queryClient, s.id);
  };
  const sessionTitle = getSessionDisplayTitle(s);
  const activityTime = s.lastActivityAt;
  const unread = (s.latestActivityEventId ?? 0) > (s.lastReadEventId ?? 0);
  const activity = sessionActivity(s, unread);
  const providerName = provider?.label ?? s.selectedProvider;
  const providerIcon = provider ? getProviderIconUrl(provider) : undefined;

  return (
    <div className="group/session relative flex items-center">
      <Link
        to={`/sessions/${s.id}`}
        onMouseEnter={prefetch}
        onFocus={prefetch}
        aria-current={isActive ? 'page' : undefined}
        className={`text-role-control motion-disclosure focus-visible:ring-accent/40 flex min-h-12 w-full min-w-0 items-start gap-2 rounded-lg px-2 py-2 text-left font-normal focus-visible:ring-2 focus-visible:outline-none ${
          isActive
            ? 'bg-surface-tertiary/60 text-text-main'
            : 'text-text-muted hover:text-text-main hover:bg-surface-secondary/70'
        }`}
      >
        <span className="flex h-4 w-2 shrink-0 items-center justify-center">
          {unread && (
            <span
              className="bg-accent h-1.5 w-1.5 shrink-0 rounded-full"
              aria-label="Unread activity"
            />
          )}
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="flex min-w-0 items-center gap-2 leading-4">
            <span
              className={`truncate ${unread ? 'text-text-main font-medium' : ''} ${s.status === 'archived' ? 'opacity-50' : ''}`}
            >
              {sessionTitle}
            </span>
            {s.pinnedAt && (
              <Pin className="icon-inline text-text-muted shrink-0" aria-label="Pinned" />
            )}
            <RelativeTime
              value={activityTime}
              className={`text-role-caption text-text-muted ml-auto w-8 shrink-0 text-right tabular-nums ${isDropdownOpen ? 'invisible' : 'group-focus-within/session:invisible group-hover/session:invisible [@media(hover:none)]:invisible'}`}
            />
          </span>
          <span className="text-role-label text-text-muted flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 leading-4 font-normal">
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
                {activity.spinning && (
                  <Loader2
                    className="icon-inline animate-spin motion-reduce:animate-none"
                    aria-hidden="true"
                  />
                )}
                <span>{activity.label}</span>
              </span>
            )}
          </span>
        </span>
      </Link>

      {/* Keep actions above the full-row link without nesting a button inside it. */}
      <div
        className={`pointer-events-none absolute top-1 right-1 flex opacity-0 transition-opacity duration-150 group-focus-within/session:pointer-events-auto group-focus-within/session:opacity-100 group-hover/session:pointer-events-auto group-hover/session:opacity-100 [@media(hover:none)]:pointer-events-auto [@media(hover:none)]:opacity-100 ${
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
    </div>
  );
}
