import { memo } from 'react';
import type { ElementType, ComponentPropsWithoutRef, ReactNode } from 'react';
import { Spinner } from '../../components/Spinner.js';
import { cn } from '../../utils.js';

export type ButtonVariant = 'ghost' | 'outline' | 'solid' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg' | 'compact' | 'default' | 'large';

export interface ButtonBaseProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
  isLoading?: boolean;
  children?: ReactNode;
  className?: string;
}

export type ButtonProps<T extends ElementType = 'button'> = ButtonBaseProps & {
  as?: T;
} & Omit<ComponentPropsWithoutRef<T>, keyof ButtonBaseProps | 'as'>;

const variants: Record<ButtonVariant, string> = {
  solid: 'bg-accent text-brand-crust hover:opacity-90 click-press',
  outline: 'bg-transparent border border-border hover:bg-white/5 text-text-main click-press',
  ghost: 'bg-transparent hover:bg-white/5 text-text-muted hover:text-text-main click-press',
  danger: 'bg-danger text-white hover:opacity-90 click-press',
};

const sizes: Record<ButtonSize, string> = {
  sm: 'control-compact',
  compact: 'control-compact',
  md: 'control-default',
  default: 'control-default',
  lg: 'control-large',
  large: 'control-large',
};

const baseStyles =
  'text-role-control inline-flex items-center justify-center gap-1.5 font-sans whitespace-nowrap shrink-0 transition-[color,background-color,border-color,opacity,transform] duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-40 disabled:pointer-events-none cursor-pointer select-none';

const ButtonComponent = <T extends ElementType = 'button'>({
  as,
  variant = 'solid',
  size = 'default',
  isLoading,
  className = '',
  children,
  disabled,
  ...props
}: ButtonProps<T>) => {
  const Component = as ?? 'button';

  return (
    <Component
      className={cn(baseStyles, variants[variant], sizes[size], className)}
      disabled={disabled || isLoading}
      aria-busy={isLoading ? true : undefined}
      {...props}
    >
      {isLoading !== undefined && (
        <Spinner aria-hidden="true" className={cn('icon-compact', !isLoading && 'invisible')} />
      )}
      {children}
    </Component>
  );
};

export const Button = memo(ButtonComponent) as typeof ButtonComponent;
