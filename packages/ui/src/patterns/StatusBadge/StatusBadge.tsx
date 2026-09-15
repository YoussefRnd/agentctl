import type { ReactNode } from 'react';
import { Badge, type BadgeSize, type BadgeVariant } from '../../components/Badge.js';

export type StatusType =
  'active' | 'running' | 'idle' | 'success' | 'warning' | 'error' | 'archived' | 'neutral';

export interface StatusBadgeProps {
  status: StatusType;
  label?: ReactNode;
  size?: BadgeSize;
  pulse?: boolean;
  className?: string;
}

const statusMap: Record<StatusType, { variant: BadgeVariant; defaultLabel: string; dot: boolean }> =
  {
    active: { variant: 'accent', defaultLabel: 'Active', dot: true },
    running: { variant: 'accent', defaultLabel: 'Running', dot: true },
    idle: { variant: 'default', defaultLabel: 'Idle', dot: true },
    success: { variant: 'success', defaultLabel: 'Success', dot: true },
    warning: { variant: 'warning', defaultLabel: 'Warning', dot: true },
    error: { variant: 'danger', defaultLabel: 'Error', dot: true },
    archived: { variant: 'outline', defaultLabel: 'Archived', dot: false },
    neutral: { variant: 'surface', defaultLabel: 'Neutral', dot: false },
  };

export function StatusBadge({ status, label, size = 'sm', pulse, className }: StatusBadgeProps) {
  const config = statusMap[status] ?? statusMap.neutral;
  const shouldPulse = pulse ?? status === 'running';

  return (
    <Badge
      variant={config.variant}
      size={size}
      dot={config.dot}
      pulse={shouldPulse}
      className={className}
    >
      {label ?? config.defaultLabel}
    </Badge>
  );
}
