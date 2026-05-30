import { type ReactNode, memo } from 'react';
import { cn } from '../utils';

interface TerminalGlassProps {
  children: ReactNode;
  className?: string;
  animate?: boolean;
}

/**
 * High-density glassmorphism panel for the OLED Terminal aesthetic.
 */
export const TerminalGlass = memo(function TerminalGlass({
  children,
  className,
  animate = false,
}: TerminalGlassProps) {
  return (
    <div
      className={cn(
        'glass-card',
        animate && 'animate-in fade-in zoom-in-95 duration-200',
        className,
      )}
    >
      {children}
    </div>
  );
});
