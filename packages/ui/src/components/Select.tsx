import * as React from 'react';
import { ChevronDown } from 'lucide-react';
import { Dropdown } from './Dropdown.js';
import { cn } from '../utils.js';

export interface SelectOption {
  value: string;
  label: string;
  icon?: React.ReactNode;
  element?: React.ReactNode;
}

export interface SelectProps {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  triggerClassName?: string;
  contentClassName?: string;
  align?: 'start' | 'center' | 'end';
  side?: 'top' | 'right' | 'bottom' | 'left';
  'aria-label'?: string;
}

export function Select({
  id,
  value,
  onChange,
  options,
  placeholder = 'Select option...',
  disabled = false,
  className,
  triggerClassName,
  contentClassName,
  align = 'start',
  side = 'bottom',
  'aria-label': ariaLabel,
}: SelectProps) {
  const selectedOption = options.find((opt) => opt.value === value);

  return (
    <div className={cn('relative w-full', className)}>
      <Dropdown.Root>
        <Dropdown.Trigger asChild>
          <button
            id={id}
            type="button"
            disabled={disabled}
            aria-label={ariaLabel}
            className={cn(
              'border-border/50 bg-surface/40 hover:bg-surface/60 text-text-main focus:border-accent/30 focus:ring-accent/20 relative flex h-9 w-full cursor-pointer items-center justify-between rounded-xl border pr-8 pl-3 text-[11px] font-bold transition-colors outline-none select-none focus:ring-1 disabled:cursor-not-allowed disabled:opacity-40',
              triggerClassName,
            )}
          >
            <span className="flex items-center gap-2 truncate">
              {selectedOption ? (
                <>
                  {selectedOption.element ?? (
                    <>
                      {selectedOption.icon}
                      <span>{selectedOption.label}</span>
                    </>
                  )}
                </>
              ) : (
                <span className="text-text-muted/50">{placeholder}</span>
              )}
            </span>
            <ChevronDown className="text-text-muted pointer-events-none absolute right-2.5 h-3.5 w-3.5 transition-transform" />
          </button>
        </Dropdown.Trigger>
        <Dropdown.Portal>
          <Dropdown.Content
            align={align}
            side={side}
            className={cn('max-h-60 overflow-y-auto', contentClassName)}
            style={{
              width: 'var(--radix-dropdown-menu-trigger-width)',
              minWidth: 'var(--radix-dropdown-menu-trigger-width)',
            }}
          >
            {options.map((opt) => {
              const isSelected = opt.value === value;
              return (
                <Dropdown.Item
                  key={opt.value}
                  className={cn(
                    'flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left text-[11px] font-bold transition-colors',
                    isSelected
                      ? 'bg-accent/10 text-accent hover:bg-accent/15'
                      : 'text-text-muted hover:text-text-main hover:bg-white/5',
                  )}
                  onClick={() => {
                    onChange(opt.value);
                  }}
                >
                  {opt.element ?? (
                    <>
                      {opt.icon}
                      <span>{opt.label}</span>
                    </>
                  )}
                </Dropdown.Item>
              );
            })}
          </Dropdown.Content>
        </Dropdown.Portal>
      </Dropdown.Root>
    </div>
  );
}
