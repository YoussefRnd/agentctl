import { type ReactNode, memo } from 'react';
import { cn } from '../utils';

interface GlassPanelProps {
  children: ReactNode;
  className?: string;
  intensity?: 'default' | 'high';
}

export const GlassPanel = memo(function GlassPanel({ 
  children, 
  className, 
  intensity = 'default' 
}: GlassPanelProps) {
  return (
    <div 
      className={cn(
        'liquid-glass flex flex-col',
        intensity === 'high' && 'bg-surface/40 backdrop-blur-[32px]',
        className
      )}
    >
      {children}
    </div>
  );
});
