import { memo } from 'react';
import { actionVariants } from '../controlStyles.js';
import type { ElementType, ComponentPropsWithRef, ReactNode } from 'react';
import { Spinner } from '../../components/Spinner.js';
import { cn } from '../../utils.js';

export type IconButtonVariant = 'ghost' | 'outline' | 'solid' | 'danger';
export type IconButtonSize = 'compact' | 'default' | 'large' | 'sm' | 'md' | 'lg';

export interface IconButtonBaseProps {
  'aria-label': string;
  variant?: IconButtonVariant;
  size?: IconButtonSize;
  isLoading?: boolean;
  children: ReactNode;
  className?: string;
}

export type IconButtonProps<T extends ElementType = 'button'> = IconButtonBaseProps & {
  as?: T;
} & Omit<ComponentPropsWithRef<T>, keyof IconButtonBaseProps | 'as'>;

const sizes: Record<IconButtonSize, string> = {
  sm: 'h-6 w-6 text-xs p-1',
  compact: 'h-7 w-7 text-xs p-1.5',
  md: 'h-8 w-8 text-sm p-1.5',
  default: 'h-8 w-8 text-sm p-1.5',
  lg: 'h-9 w-9 text-base p-2',
  large: 'h-9 w-9 text-base p-2',
};

const baseStyles =
  'inline-flex items-center justify-center rounded-lg font-sans transition-[color,background-color,border-color,opacity,transform] duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-40 disabled:pointer-events-none cursor-pointer select-none';

const IconButtonComponent = <T extends ElementType = 'button'>({
  as,
  variant = 'ghost',
  size = 'default',
  isLoading = false,
  className = '',
  children,
  disabled,
  'aria-label': ariaLabel,
  ...props
}: IconButtonProps<T>) => {
  const Component = as ?? 'button';

  return (
    <Component
      type={Component === 'button' ? 'button' : undefined}
      className={cn(baseStyles, actionVariants[variant], sizes[size], className)}
      disabled={disabled || isLoading}
      aria-label={ariaLabel}
      aria-busy={isLoading ? true : undefined}
      {...props}
    >
      {isLoading ? <Spinner aria-hidden="true" className="icon-compact" /> : children}
    </Component>
  );
};

export const IconButton = memo(IconButtonComponent) as typeof IconButtonComponent;
