import { memo } from 'react';
import { actionVariants, controlSizes } from '../controlStyles.js';
import type { ElementType, ComponentPropsWithRef, ReactNode } from 'react';
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
} & Omit<ComponentPropsWithRef<T>, keyof ButtonBaseProps | 'as'>;

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
      type={Component === 'button' ? 'button' : undefined}
      className={cn(baseStyles, actionVariants[variant], controlSizes[size], className)}
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
