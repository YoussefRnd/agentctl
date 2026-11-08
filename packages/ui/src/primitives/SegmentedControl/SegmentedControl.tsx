import type { ComponentPropsWithoutRef, ReactNode } from 'react';
import { useTabNavigation } from '../Tabs/useTabNavigation.js';
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
  ...props
}: SegmentedControlProps<Value>) {
  const navigation = useTabNavigation({
    value,
    onValueChange,
    items: disabled ? options.map(({ value }) => ({ value, disabled: true })) : options,
    selectionMode: 'buttons',
  });
  const list = navigation.getListProps(props);

  return (
    <div
      data-slot="segmented-control"
      {...list}
      role={props.role ?? list.role}
      className={cn(
        'border-border/40 bg-surface/40 flex max-w-full flex-wrap gap-1 rounded-lg border p-1',
        fullWidth && 'w-full',
        className,
      )}
    >
      {options.map((option) => (
        <button
          key={option.value}
          {...navigation.getItemProps(option.value, {
            'aria-label': option['aria-label'],
            title: option.title,
            onMouseDown: preserveFocus ? (event) => event.preventDefault() : undefined,
          })}
          id={option.id}
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
