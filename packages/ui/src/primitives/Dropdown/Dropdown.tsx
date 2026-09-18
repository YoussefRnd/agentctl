import * as React from 'react';
import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu';
import { cn } from '../../utils.js';

export function DropdownRoot({
  modal = false,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Root>) {
  return <DropdownMenuPrimitive.Root modal={modal} {...props} />;
}

export const DropdownTrigger = DropdownMenuPrimitive.Trigger;
export const DropdownPortal = DropdownMenuPrimitive.Portal;

export function DropdownContent({
  className,
  children,
  sideOffset = 4,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Content>) {
  return (
    <DropdownMenuPrimitive.Content
      sideOffset={sideOffset}
      className="bounded-glass-shell motion-floating z-dropdown animate-in fade-in-0 data-[side=bottom]:slide-in-from-top-1 data-[side=left]:slide-in-from-right-1 data-[side=right]:slide-in-from-left-1 data-[side=top]:slide-in-from-bottom-1 min-w-32 origin-(--radix-dropdown-menu-content-transform-origin) rounded-xl outline-none"
      {...props}
    >
      <div className={cn('bounded-glass-surface min-w-32 rounded-xl p-1', className)}>
        {children}
      </div>
    </DropdownMenuPrimitive.Content>
  );
}

export function DropdownItem({
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Item>) {
  return (
    <DropdownMenuPrimitive.Item
      className={cn(
        'focus-visible:ring-accent/40 flex cursor-pointer items-center rounded-lg px-2.5 py-1.5 text-[11px] font-medium outline-none select-none hover:bg-white/5 focus-visible:bg-white/5 focus-visible:ring-1',
        className,
      )}
      {...props}
    />
  );
}

export function DropdownSeparator({
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Separator>) {
  return (
    <DropdownMenuPrimitive.Separator
      className={cn('my-1 h-px bg-white/10', className)}
      {...props}
    />
  );
}

export const DropdownSub = DropdownMenuPrimitive.Sub;

export function DropdownSubTrigger({
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.SubTrigger>) {
  return (
    <DropdownMenuPrimitive.SubTrigger
      className={cn(
        'flex cursor-pointer items-center justify-between rounded-md px-2 py-1.5 text-[11px] font-bold outline-none select-none hover:bg-white/5 focus-visible:bg-white/5 data-[state=open]:bg-white/5',
        className,
      )}
      {...props}
    />
  );
}

export function DropdownSubContent({
  className,
  children,
  sideOffset = 2,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.SubContent>) {
  return (
    <DropdownMenuPrimitive.SubContent
      sideOffset={sideOffset}
      className="bounded-glass-shell motion-floating z-dropdown animate-in fade-in-0 data-[side=bottom]:slide-in-from-top-1 data-[side=left]:slide-in-from-right-1 data-[side=right]:slide-in-from-left-1 data-[side=top]:slide-in-from-bottom-1 min-w-32 origin-(--radix-dropdown-menu-content-transform-origin) rounded-xl outline-none"
      {...props}
    >
      <div className={cn('bounded-glass-surface min-w-32 rounded-xl p-1', className)}>
        {children}
      </div>
    </DropdownMenuPrimitive.SubContent>
  );
}

export function Dropdown(props: React.ComponentProps<typeof DropdownMenuPrimitive.Root>) {
  return <DropdownMenuPrimitive.Root {...props} />;
}

Dropdown.Root = DropdownRoot;
Dropdown.Trigger = DropdownTrigger;
Dropdown.Portal = DropdownPortal;
Dropdown.Content = DropdownContent;
Dropdown.Item = DropdownItem;
Dropdown.Separator = DropdownSeparator;
Dropdown.Sub = DropdownSub;
Dropdown.SubTrigger = DropdownSubTrigger;
Dropdown.SubContent = DropdownSubContent;
