import { type ReactNode, memo } from 'react';
import { cn } from '../utils';

interface GlassPanelProps {
  children: ReactNode;
  className?: string;
  intensity?: 'default' | 'high';
  style?: React.CSSProperties;
}

export const GlassPanel = memo(function GlassPanel({
  children,
  className,
  intensity = 'default',
  style,
}: GlassPanelProps) {
  return (
    <div
      style={style}
      className={cn(
        'liquid-glass flex min-h-0 min-w-0 flex-col rounded-lg',
        intensity === 'high' && 'bg-surface/40 backdrop-blur-[32px]',
        className,
      )}
    >
      {children}
    </div>
  );
});
