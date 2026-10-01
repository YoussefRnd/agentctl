import React from 'react';
import { Check, ChevronDown, ChevronUp } from 'lucide-react';
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
  icon?: React.ReactNode;
  align?: 'start' | 'end';
  variant?: 'default' | 'toolbar';
  side?: 'top' | 'right' | 'bottom' | 'left';
  title?: string;
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
  title,
}: CommandDropdownProps<T>) {
  const activeOption = options.find((opt) => opt.value === value);

  const triggerClass =
    variant === 'toolbar'
      ? cn(
          'motion-disclosure group flex h-8 cursor-pointer items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium',
          'border-border/25 bg-surface-secondary/35 text-text-muted hover:border-border/50 hover:bg-surface-secondary/70 hover:text-text-main focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:ring-offset-1 focus-visible:ring-offset-transparent',
          'disabled:pointer-events-none disabled:opacity-40',
          'data-[state=open]:bg-accent/20 data-[state=open]:text-accent data-[state=open]:border-accent/50',
        )
      : cn(
          'motion-disclosure group text-text-muted hover:text-text-main flex cursor-pointer items-center gap-1.5 text-xs font-medium',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:ring-offset-1 focus-visible:ring-offset-transparent',
          'disabled:pointer-events-none disabled:opacity-40',
        );

  const textClass =
    variant === 'toolbar' ? 'max-w-[150px] truncate text-xs font-medium' : 'max-w-[150px] truncate';

  const ChevronIcon = side === 'top' ? ChevronUp : ChevronDown;

  return (
    <Dropdown.Root>
      <Dropdown.Trigger asChild>
        <button
          type="button"
          disabled={disabled}
          title={title}
          aria-label={title ? `${title}: ${activeOption?.label ?? value}` : undefined}
          className={triggerClass}
        >
          {icon}
          <span
            className={cn(
              textClass,
              (activeOption?.value === 'yolo' || value === 'yolo') && 'text-danger!',
            )}
          >
            {activeOption?.label ?? value}
          </span>
          <ChevronIcon className="text-text-muted/60 h-3.5 w-3.5 transition-transform duration-200 group-data-[state=open]:rotate-180" />
        </button>
      </Dropdown.Trigger>
      <Dropdown.Portal>
        <Dropdown.Content
          align={align}
          side={side}
          avoidCollisions={false}
          className="min-w-[130px]"
        >
          {options.map((opt) => (
            <Dropdown.Item
              key={opt.value}
              className={cn(
                'flex items-center justify-between gap-3 text-[11px]',
                opt.value === value && 'bg-accent/10 text-accent font-medium',
                opt.value === 'yolo' && 'text-danger!',
              )}
              onClick={() => {
                onChange(opt.value);
              }}
            >
              <span>{opt.label}</span>
              {opt.value === value && <Check className="h-3 w-3 shrink-0" />}
            </Dropdown.Item>
          ))}
        </Dropdown.Content>
      </Dropdown.Portal>
    </Dropdown.Root>
  );
}
