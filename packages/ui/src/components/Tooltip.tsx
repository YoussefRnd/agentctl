import * as React from 'react';
import * as PopoverPrimitive from '@radix-ui/react-popover';
import { cn } from '../utils.js';

interface TooltipProps {
  content: React.ReactNode;
  children: React.ReactElement;
  className?: string;
}

export function Tooltip({ content, children, className }: TooltipProps) {
  const [open, setOpen] = React.useState(false);
  const child = children as React.ReactElement<{
    onMouseEnter?: (e: React.MouseEvent) => void;
    onMouseLeave?: (e: React.MouseEvent) => void;
    onFocus?: (e: React.FocusEvent) => void;
    onBlur?: (e: React.FocusEvent) => void;
  }>;

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      <PopoverPrimitive.Trigger asChild>
        {React.cloneElement(child, {
          onMouseEnter: (e: React.MouseEvent) => {
            setOpen(true);
            child.props.onMouseEnter?.(e);
          },
          onMouseLeave: (e: React.MouseEvent) => {
            setOpen(false);
            child.props.onMouseLeave?.(e);
          },
          onFocus: (e: React.FocusEvent) => {
            setOpen(true);
            child.props.onFocus?.(e);
          },
          onBlur: (e: React.FocusEvent) => {
            setOpen(false);
            child.props.onBlur?.(e);
          },
        })}
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          side="top"
          align="center"
          sideOffset={6}
          onOpenAutoFocus={(e) => {
            e.preventDefault();
          }}
          className={cn(
            'bg-surface-secondary/95 border border-border/30 text-text-main pointer-events-none z-[1000] rounded-md px-2 py-1 font-sans text-[9px] font-bold tracking-wider whitespace-nowrap uppercase shadow-xl backdrop-blur-sm transition-all duration-150 ease-out outline-none data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95',
            className
          )}
        >
          {content}
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
