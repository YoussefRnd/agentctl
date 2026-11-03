import type { ReactNode } from 'react';

export function SidebarSessionRowLayout({
  title,
  detail,
  time,
  pin,
  unread = false,
  dimmed = false,
  active = false,
  actions,
  renderBody,
}: {
  title: ReactNode;
  detail: ReactNode;
  time?: ReactNode;
  pin?: ReactNode;
  unread?: boolean;
  dimmed?: boolean;
  active?: boolean;
  actions?: ReactNode;
  renderBody?: (content: ReactNode, className: string) => ReactNode;
}) {
  const className = `text-role-control motion-disclosure focus-visible:ring-accent/40 flex min-h-12 w-full min-w-0 items-start gap-2 rounded-lg px-2 py-2 text-left font-normal focus-visible:ring-2 focus-visible:outline-none ${active ? 'bg-surface-tertiary/60 text-text-main' : 'text-text-muted hover:text-text-main hover:bg-surface-secondary/70'}`;
  const content = (
    <>
      <span className="flex h-4 w-3.5 shrink-0 items-center justify-center">
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
            className={`truncate ${unread ? 'text-text-main font-medium' : ''} ${dimmed ? 'opacity-50' : ''}`}
          >
            {title}
          </span>
          {pin}
          <span className="ml-auto min-w-8 shrink-0">{time}</span>
        </span>
        <span className="text-role-label text-text-muted flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 leading-4 font-normal">
          {detail}
        </span>
      </span>
    </>
  );
  return (
    <div className="group/session relative flex items-center">
      {renderBody ? renderBody(content, className) : <div className={className}>{content}</div>}
      {actions}
    </div>
  );
}

export function SidebarProjectHeaderLayout({
  icon,
  title,
  activity,
  actions,
  path,
  expanded,
  onToggle,
}: {
  icon: ReactNode;
  title: ReactNode;
  activity?: ReactNode;
  actions?: ReactNode;
  path?: string;
  expanded?: boolean;
  onToggle?: () => void;
}) {
  const Summary = onToggle ? 'button' : 'div';
  return (
    <div className="motion-disclosure group/workspace hover:bg-surface-secondary/50 relative flex min-h-9 items-center gap-1 rounded-lg px-2 py-1">
      <Summary
        type={onToggle ? 'button' : undefined}
        aria-expanded={onToggle ? expanded : undefined}
        title={path}
        onClick={onToggle}
        className="text-role-control motion-disclosure focus-visible:ring-accent/40 flex min-h-7 min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-md border-none bg-transparent p-0 text-left outline-none focus-visible:ring-2"
      >
        {icon}
        <span className="text-text-main truncate font-medium">{title}</span>
        {activity}
      </Summary>
      {actions}
    </div>
  );
}

export function SidebarProjectGroupLayout({
  header,
  children,
}: {
  header: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1">
      {header}
      {children}
    </div>
  );
}
