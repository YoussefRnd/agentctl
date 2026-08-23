import * as React from 'react';
import * as PopoverPrimitive from '@radix-ui/react-popover';
import { cn } from '../utils.js';

interface TooltipProps {
  content: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  side?: 'top' | 'right' | 'bottom' | 'left';
  align?: 'start' | 'center' | 'end';
  delayDuration?: number;
}

export function Tooltip({
  content,
  children,
  className,
  side = 'top',
  align = 'center',
  delayDuration = 150,
}: TooltipProps) {
  const [open, setOpen] = React.useState(false);
  const timerRef = React.useRef<number | null>(null);

  const handleOpen = () => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
    }
    timerRef.current = window.setTimeout(() => {
      setOpen(true);
    }, delayDuration);
  };

  const handleClose = () => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
    }
    setOpen(false);
  };

  React.useEffect(() => {
    return () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
      }
    };
  }, []);

  if (!content) return <>{children}</>;

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen} modal={false}>
      <PopoverPrimitive.Trigger asChild>
        <span
          role="presentation"
          className="inline-flex"
          onMouseEnter={handleOpen}
          onMouseLeave={handleClose}
          onFocus={handleOpen}
          onBlur={handleClose}
          onClick={handleClose}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              handleClose();
            }
          }}
        >
          {children}
        </span>
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          side={side}
          align={align}
          sideOffset={6}
          onOpenAutoFocus={(e) => {
            e.preventDefault();
          }}
          onCloseAutoFocus={(e) => {
            e.preventDefault();
          }}
          className={cn(
            'bg-surface-secondary/95 border-border/30 text-text-main data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 pointer-events-none z-[1000] origin-(--radix-popover-content-transform-origin) rounded-md border px-2 py-1 font-sans text-[10px] font-semibold tracking-wide whitespace-nowrap shadow-xl backdrop-blur-sm duration-150 ease-out outline-none',
            className,
          )}
        >
          {content}
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
