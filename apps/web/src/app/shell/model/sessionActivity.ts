import type { SidebarProject } from '@agentctl/shared';

type SidebarSession = SidebarProject['sessions'][number];

export function sessionActivity(session: SidebarSession, unread: boolean) {
  if (session.status === 'archived') return { label: 'Archived', color: 'text-text-muted' };
  if (session.status === 'merged') return { label: 'Merged', color: 'text-text-muted' };
  if (session.status === 'discarded') return { label: 'Discarded', color: 'text-text-muted' };
  const activity =
    session.sidebarActivity ??
    (session.status === 'running'
      ? 'working'
      : session.status === 'needs_attention'
        ? 'approval'
        : session.status === 'error'
          ? 'failed'
          : 'idle');
  switch (activity) {
    case 'working':
      return { label: 'Working', color: 'text-text-muted', spinning: true };
    case 'approval':
      return { label: 'Needs approval', color: 'text-warning' };
    case 'input':
      return { label: 'Awaiting input', color: 'text-warning' };
    case 'failed':
      return { label: 'Failed', color: 'text-danger' };
    case 'completed':
      return unread ? { label: 'Completed', color: 'text-success' } : null;
    case 'stopped':
      return { label: 'Stopped', color: 'text-text-muted' };
    default:
      return null;
  }
}
