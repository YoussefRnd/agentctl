import * as React from 'react';
import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu';
import { cn } from '../utils';

export const Dropdown = DropdownMenuPrimitive.Root;
export const DropdownTrigger = DropdownMenuPrimitive.Trigger;
export const DropdownGroup = DropdownMenuPrimitive.Group;
export const DropdownPortal = DropdownMenuPrimitive.Portal;
export const DropdownSub = DropdownMenuPrimitive.Sub;
export const DropdownRadioGroup = DropdownMenuPrimitive.RadioGroup;

export const DropdownContent = React.forwardRef<
  React.ComponentRef<typeof DropdownMenuPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Content>
>(({ className, sideOffset = 4, ...props }, ref) => (
  <DropdownMenuPrimitive.Portal>
    <DropdownMenuPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn(
        'z-50 min-w-[8rem] overflow-hidden rounded-xl border border-border/40 bg-surface-secondary/95 p-1 text-text-main shadow-xl shadow-black/40 backdrop-blur-md',
        'animate-in fade-in slide-in-from-bottom-2 duration-150',
        className
      )}
      {...props}
    />
  </DropdownMenuPrimitive.Portal>
));
DropdownContent.displayName = DropdownMenuPrimitive.Content.displayName;

export const DropdownItem = React.forwardRef<
  React.ComponentRef<typeof DropdownMenuPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Item> & {
    inset?: boolean;
    active?: boolean;
  }
>(({ className, inset, active, ...props }, ref) => (
  <DropdownMenuPrimitive.Item
    ref={ref}
    className={cn(
      'relative flex cursor-pointer select-none items-center rounded-lg px-3 py-2 text-[10px] font-bold tracking-widest uppercase outline-none transition-colors focus:bg-white/5 focus:text-text-main data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
      active && 'bg-accent/15 text-accent focus:bg-accent/20 focus:text-accent',
      inset && 'pl-8',
      className
    )}
    {...props}
  />
));
DropdownItem.displayName = DropdownMenuPrimitive.Item.displayName;

export const DropdownLabel = React.forwardRef<
  React.ComponentRef<typeof DropdownMenuPrimitive.Label>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Label> & {
    inset?: boolean;
  }
>(({ className, inset, ...props }, ref) => (
  <DropdownMenuPrimitive.Label
    ref={ref}
    className={cn(
      'px-3 py-1.5 text-[10px] font-bold tracking-widest uppercase text-text-muted',
      inset && 'pl-8',
      className
    )}
    {...props}
  />
));
DropdownLabel.displayName = DropdownMenuPrimitive.Label.displayName;

export const DropdownSeparator = React.forwardRef<
  React.ComponentRef<typeof DropdownMenuPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <DropdownMenuPrimitive.Separator
    ref={ref}
    className={cn('-mx-1 my-1 h-px bg-border/20', className)}
    {...props}
  />
));
DropdownSeparator.displayName = DropdownMenuPrimitive.Separator.displayName;
