import * as React from 'react';
import * as PopoverPrimitive from '@radix-ui/react-popover';
import { cn } from '../../utils.js';

export interface TooltipProps {
  content: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  side?: 'top' | 'right' | 'bottom' | 'left';
  align?: 'start' | 'center' | 'end';
  delayDuration?: number;
}

let activeTooltipCount = 0;
let lastTooltipClosedAt = 0;
const SKIP_DELAY_THRESHOLD_MS = 300;

export function Tooltip({
  content,
  children,
  className,
  side = 'top',
  align = 'center',
  delayDuration = 150,
}: TooltipProps) {
  const [open, setOpen] = React.useState(false);
  const tooltipId = React.useId();
  const timerRef = React.useRef<number | null>(null);

  const handleOpen = () => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const isRecentOrActive =
      activeTooltipCount > 0 || Date.now() - lastTooltipClosedAt < SKIP_DELAY_THRESHOLD_MS;
    const delay = isRecentOrActive ? 0 : delayDuration;
    if (delay === 0) {
      setOpen(true);
    } else {
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        setOpen(true);
      }, delay);
    }
  };

  const handleClose = () => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setOpen(false);
  };

  React.useEffect(() => {
    if (!open) return;
    activeTooltipCount++;
    return () => {
      activeTooltipCount = Math.max(0, activeTooltipCount - 1);
      lastTooltipClosedAt = Date.now();
    };
  }, [open]);
  React.useEffect(
    () => () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    },
    [],
  );

  if (!content) return <>{children}</>;

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen} modal={false}>
      <PopoverPrimitive.Anchor asChild>
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
          {React.isValidElement<{ 'aria-describedby'?: string }>(children)
            ? React.cloneElement(children, {
                'aria-describedby':
                  [children.props['aria-describedby'], open ? tooltipId : undefined]
                    .filter(Boolean)
                    .join(' ') || undefined,
              })
            : children}
        </span>
      </PopoverPrimitive.Anchor>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          role="tooltip"
          id={tooltipId}
          side={side}
          align={align}
          sideOffset={6}
          collisionPadding={16}
          onOpenAutoFocus={(e) => {
            e.preventDefault();
          }}
          onCloseAutoFocus={(e) => {
            e.preventDefault();
          }}
          className={cn(
            'bg-surface-secondary/95 border-border/30 text-text-main data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-98 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-98 z-tooltip pointer-events-none max-w-[min(24rem,calc(100vw-2rem))] origin-(--radix-popover-content-transform-origin) rounded-md border px-2 py-1 font-sans text-[10px] font-semibold tracking-wide [overflow-wrap:anywhere] whitespace-normal shadow-xl backdrop-blur-sm duration-100 ease-out outline-none',
            className,
          )}
        >
          {content}
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
