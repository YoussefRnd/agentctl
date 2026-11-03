import type { ComponentPropsWithoutRef, KeyboardEvent, ReactNode } from 'react';
import { cn } from '../../utils.js';

export interface SegmentedControlOption<Value extends string> {
  value: Value;
  label: ReactNode;
  icon?: ReactNode;
  disabled?: boolean;
  id?: string;
  'aria-label'?: string;
  title?: string;
  className?: string;
}

export type SegmentedControlProps<Value extends string> = Omit<
  ComponentPropsWithoutRef<'div'>,
  'children' | 'onChange' | 'defaultValue'
> & {
  value: Value;
  onValueChange: (value: Value) => void;
  options: readonly SegmentedControlOption<Value>[];
  disabled?: boolean;
  fullWidth?: boolean;
  /** Search filters can keep keyboard focus in their associated input on pointer selection. */
  preserveFocus?: boolean;
  /** Preserve an established text size or weight; no font family is imposed. */
  typographyClassName?: string;
  /** Compact toolbars can retain their existing dimensions. */
  itemClassName?: string;
} & ({ 'aria-label': string } | { 'aria-labelledby': string });

/** The existing Theme Mode appearance, shared by mutually exclusive inline choices. */
export function SegmentedControl<Value extends string>({
  value,
  onValueChange,
  options,
  disabled = false,
  fullWidth = false,
  preserveFocus = false,
  typographyClassName = 'text-xs font-semibold',
  itemClassName,
  className,
  onKeyDown,
  ...props
}: SegmentedControlProps<Value>) {
  const enabledOptions = options.filter((option) => !disabled && !option.disabled);
  const tabStop = enabledOptions.find((option) => option.value === value) ?? enabledOptions[0];

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    onKeyDown?.(event);
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
    const buttons = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>(':scope > button:not(:disabled)'),
    );
    const current = buttons.indexOf(event.target as HTMLButtonElement);
    if (current < 0 || !buttons.length) return;
    const rtl = getComputedStyle(event.currentTarget).direction === 'rtl';
    let next: number;
    switch (event.key) {
      case 'ArrowRight':
        next = (current + (rtl ? -1 : 1) + buttons.length) % buttons.length;
        break;
      case 'ArrowLeft':
        next = (current + (rtl ? 1 : -1) + buttons.length) % buttons.length;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = buttons.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    buttons[next]?.focus();
    buttons[next]?.click();
  };

  return (
    <div
      role="group"
      data-slot="segmented-control"
      className={cn(
        'border-border/40 bg-surface/40 flex max-w-full flex-wrap gap-1 rounded-lg border p-1',
        fullWidth && 'w-full',
        className,
      )}
      onKeyDown={handleKeyDown}
      {...props}
    >
      {options.map((option) => (
        <button
          key={option.value}
          id={option.id}
          type="button"
          disabled={disabled || option.disabled}
          aria-pressed={value === option.value}
          aria-label={option['aria-label']}
          title={option.title}
          tabIndex={tabStop?.value === option.value ? 0 : -1}
          onMouseDown={preserveFocus ? (event) => event.preventDefault() : undefined}
          onClick={() => onValueChange(option.value)}
          className={cn(
            'flex cursor-pointer items-center gap-1.5 rounded-md px-3 py-1.5',
            typographyClassName,
            'transition-colors',
            value === option.value
              ? 'bg-accent text-brand-crust shadow-sm'
              : 'text-text-muted hover:text-text-main hover:bg-surface/60',
            fullWidth && 'min-w-0 flex-1 justify-center',
            (disabled || option.disabled) && 'cursor-not-allowed opacity-40',
            itemClassName,
            option.className,
          )}
        >
          {option.icon}
          {typeof option.label === 'string' || typeof option.label === 'number' ? (
            <span>{option.label}</span>
          ) : (
            option.label
          )}
        </button>
      ))}
    </div>
  );
}
