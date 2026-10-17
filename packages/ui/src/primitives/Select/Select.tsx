import * as React from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { Dropdown } from '../Dropdown/index.js';
import { cn } from '../../utils.js';

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
  'aria-describedby'?: string;
  'aria-errormessage'?: string;
  'aria-invalid'?: React.AriaAttributes['aria-invalid'];
  'aria-required'?: React.AriaAttributes['aria-required'];
  required?: boolean;
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
  'aria-describedby': describedBy,
  'aria-errormessage': errorMessage,
  'aria-invalid': invalid,
  'aria-required': ariaRequired,
  required,
}: SelectProps) {
  const selectedOption = options.find((opt) => opt.value === value);

  return (
    <div className={cn('relative w-full min-w-0', className)}>
      {/* Select menus must form their own modal interaction layer so their
          portaled content remains interactive inside dialogs. */}
      <Dropdown.Root modal>
        <Dropdown.Trigger asChild>
          <button
            id={id}
            type="button"
            disabled={disabled}
            aria-label={ariaLabel}
            aria-describedby={describedBy}
            aria-errormessage={errorMessage}
            aria-invalid={invalid}
            aria-required={ariaRequired ?? required}
            title={selectedOption?.label}
            className={cn(
              'motion-disclosure border-border/30 bg-surface/40 hover:bg-surface/60 text-text-main focus:border-accent/30 focus:ring-accent/20 data-[state=open]:border-accent/40 data-[state=open]:bg-accent/10 control-default group relative flex w-full min-w-0 cursor-pointer items-center justify-between border pr-8 outline-none select-none focus:ring-1 disabled:cursor-not-allowed disabled:opacity-40',
              triggerClassName,
            )}
          >
            <span className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden [&>svg]:shrink-0">
              {selectedOption ? (
                <>
                  {selectedOption.element ?? (
                    <>
                      {selectedOption.icon}
                      <span className="truncate">{selectedOption.label}</span>
                    </>
                  )}
                </>
              ) : (
                <span className="text-text-muted/50 truncate">{placeholder}</span>
              )}
            </span>
            <ChevronDown className="text-text-muted pointer-events-none absolute right-2.5 h-3.5 w-3.5 transition-transform group-data-[state=open]:rotate-180" />
          </button>
        </Dropdown.Trigger>
        <Dropdown.Portal>
          <Dropdown.Content
            align={align}
            side={side}
            className={cn('max-h-60 min-w-0 overflow-y-auto', contentClassName)}
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
                  role="menuitemradio"
                  aria-checked={isSelected}
                  className={cn(
                    'flex w-full cursor-pointer items-center justify-between gap-2 px-2.5 py-1.5 text-left text-[11px] font-medium transition-colors',
                    isSelected
                      ? 'bg-accent/10 text-accent hover:bg-accent/15'
                      : 'text-text-muted hover:text-text-main hover:bg-white/5',
                  )}
                  onSelect={() => {
                    onChange(opt.value);
                  }}
                >
                  <span className="flex min-w-0 flex-1 items-center gap-2 [&>svg]:shrink-0">
                    {opt.element ?? (
                      <>
                        {opt.icon}
                        <span className="min-w-0 [overflow-wrap:anywhere]">{opt.label}</span>
                      </>
                    )}
                  </span>
                  {isSelected && <Check className="h-3 w-3 shrink-0" />}
                </Dropdown.Item>
              );
            })}
          </Dropdown.Content>
        </Dropdown.Portal>
      </Dropdown.Root>
    </div>
  );
}
