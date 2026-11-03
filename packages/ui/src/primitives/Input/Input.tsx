import { type ComponentPropsWithoutRef, memo, type Ref } from 'react';
import { controlSizes } from '../controlStyles.js';
import { cn } from '../../utils.js';

export type InputSize = 'compact' | 'default' | 'large' | 'sm' | 'md' | 'lg';

export interface InputProps extends ComponentPropsWithoutRef<'input'> {
  ref?: Ref<HTMLInputElement>;
  sizeVariant?: InputSize;
  hasError?: boolean;
}

export const Input = memo(function Input({
  className,
  sizeVariant = 'default',
  hasError = false,
  ref,
  ...props
}: InputProps) {
  const isError = hasError || props['aria-invalid'] === true || props['aria-invalid'] === 'true';

  return (
    <input
      ref={ref}
      className={cn(
        'text-role-control border-border bg-surface/40 placeholder:text-text-muted/40 focus:border-accent/40 focus:ring-accent/10 max-w-full min-w-0 border transition-colors outline-none focus:ring-1 disabled:cursor-not-allowed disabled:opacity-40',
        controlSizes[sizeVariant],
        isError && 'border-danger focus:border-danger focus:ring-danger/20',
        className,
      )}
      {...props}
    />
  );
});
