import * as React from 'react';
import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu';
import { cn } from '../utils.js';

export const Dropdown = {
  Root: DropdownMenuPrimitive.Root,
  Trigger: DropdownMenuPrimitive.Trigger,
  Portal: DropdownMenuPrimitive.Portal,
  Content: ({ className, ...props }: React.ComponentProps<typeof DropdownMenuPrimitive.Content>) => (
    <DropdownMenuPrimitive.Content
      className={cn(
        'terminal-glass p-1 min-w-40 animate-in fade-in zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2',
        className
      )}
      {...props}
    />
  ),
  Item: ({ className, ...props }: React.ComponentProps<typeof DropdownMenuPrimitive.Item>) => (
    <DropdownMenuPrimitive.Item
      className={cn(
        'flex items-center px-2 py-1.5 text-[11px] font-bold rounded-md cursor-pointer hover:bg-white/5 outline-none focus:bg-white/5',
        className
      )}
      {...props}
    />
  ),
};
