import React from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { Dropdown, cn } from '@agentctl/ui';

interface DropdownOption<T> {
  value: T;
  label: string;
}

interface CommandDropdownProps<T> {
  value: T;
  options: DropdownOption<T>[];
  onChange: (value: T) => void;
  disabled?: boolean;
  icon: React.ReactNode;
  align?: 'start' | 'end';
  variant?: 'default' | 'toolbar';
  side?: 'top' | 'right' | 'bottom' | 'left';
}

export function CommandDropdown<T extends string>({
  value,
  options,
  onChange,
  disabled,
  icon,
  align = 'start',
  variant = 'default',
  side = 'top',
}: CommandDropdownProps<T>) {
  const activeOption = options.find((opt) => opt.value === value);

  const triggerClass =
    variant === 'toolbar'
      ? cn(
          'group flex h-8 items-center gap-2 rounded-full border border-transparent px-3 transition-all duration-200',
          'text-text-muted hover:text-text-main hover:bg-text-main/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:ring-offset-1 focus-visible:ring-offset-transparent',
          'disabled:pointer-events-none disabled:opacity-40',
          'data-[state=open]:bg-accent/20 data-[state=open]:text-accent data-[state=open]:border-accent/50',
        )
      : cn(
          'group text-text-muted hover:text-text-main flex cursor-pointer items-center gap-1.5 text-xs font-medium transition-colors duration-200',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:ring-offset-1 focus-visible:ring-offset-transparent',
          'disabled:pointer-events-none disabled:opacity-40',
        );

  const textClass =
    variant === 'toolbar' ? 'max-w-[150px] truncate text-xs font-medium' : 'max-w-[150px] truncate';

  const ChevronIcon = side === 'top' ? ChevronUp : ChevronDown;

  return (
    <Dropdown.Root>
      <Dropdown.Trigger asChild>
        <button type="button" disabled={disabled} className={triggerClass}>
          {icon}
          <span
            className={cn(
              textClass,
              (activeOption?.value === 'yolo' || value === 'yolo') && 'text-danger!',
            )}
          >
            {activeOption?.label ?? value}
          </span>
          <ChevronIcon className="text-text-muted/50 h-3 w-3 transition-transform duration-200 group-data-[state=open]:rotate-180" />
        </button>
      </Dropdown.Trigger>
      <Dropdown.Portal>
        <Dropdown.Content
          align={align}
          side={side}
          avoidCollisions={false}
          className="min-w-[140px]"
        >
          {options.map((opt) => (
            <Dropdown.Item
              key={opt.value}
              className={cn(
                opt.value === value && 'bg-surface-secondary text-accent',
                opt.value === 'yolo' && 'text-danger!',
              )}
              onClick={() => {
                onChange(opt.value);
              }}
            >
              {opt.label}
            </Dropdown.Item>
          ))}
        </Dropdown.Content>
      </Dropdown.Portal>
    </Dropdown.Root>
  );
}
