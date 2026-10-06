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
  collisionPadding = 16,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Content>) {
  return (
    <DropdownMenuPrimitive.Content
      sideOffset={sideOffset}
      collisionPadding={collisionPadding}
      className="bounded-glass-shell motion-floating z-dropdown animate-in fade-in-0 data-[side=bottom]:slide-in-from-top-1 data-[side=left]:slide-in-from-right-1 data-[side=right]:slide-in-from-left-1 data-[side=top]:slide-in-from-bottom-1 flex max-h-(--radix-dropdown-menu-content-available-height) max-w-[calc(100vw-2rem)] min-w-32 origin-(--radix-dropdown-menu-content-transform-origin) flex-col rounded-lg outline-none"
      {...props}
    >
      <div
        className={cn(
          'bounded-glass-surface max-h-(--radix-dropdown-menu-content-available-height) min-h-0 max-w-full min-w-32 overflow-y-auto rounded-lg p-1',
          className,
        )}
      >
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
        'focus-visible:ring-accent/40 hover:bg-surface-secondary/50 focus:bg-surface-secondary/50 flex min-w-0 cursor-pointer items-center rounded-md px-2.5 py-1.5 text-[11px] font-medium [overflow-wrap:anywhere] outline-none select-none focus-visible:ring-1',
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
      className={cn('bg-border/60 my-1 h-px', className)}
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
        'hover:bg-surface-secondary/50 focus:bg-surface-secondary/50 data-[state=open]:bg-surface-secondary/50 flex min-w-0 cursor-pointer items-center justify-between rounded-md px-2 py-1.5 text-[11px] font-bold [overflow-wrap:anywhere] outline-none select-none',
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
  collisionPadding = 16,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.SubContent>) {
  return (
    <DropdownMenuPrimitive.SubContent
      sideOffset={sideOffset}
      collisionPadding={collisionPadding}
      className="bounded-glass-shell motion-floating z-dropdown animate-in fade-in-0 data-[side=bottom]:slide-in-from-top-1 data-[side=left]:slide-in-from-right-1 data-[side=right]:slide-in-from-left-1 data-[side=top]:slide-in-from-bottom-1 flex max-h-(--radix-dropdown-menu-content-available-height) max-w-[calc(100vw-2rem)] min-w-32 origin-(--radix-dropdown-menu-content-transform-origin) flex-col rounded-lg outline-none"
      {...props}
    >
      <div
        className={cn(
          'bounded-glass-surface max-h-(--radix-dropdown-menu-content-available-height) min-h-0 max-w-full min-w-32 overflow-y-auto rounded-lg p-1',
          className,
        )}
      >
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
