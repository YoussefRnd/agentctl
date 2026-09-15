import { memo } from 'react';
import type { ElementType, ComponentPropsWithoutRef, ReactNode } from 'react';
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
} & Omit<ComponentPropsWithoutRef<T>, keyof IconButtonBaseProps | 'as'>;

const variants: Record<IconButtonVariant, string> = {
  solid: 'bg-accent text-brand-crust hover:opacity-90 active:scale-[0.97]',
  outline:
    'bg-transparent border border-border hover:bg-white/5 text-text-main active:scale-[0.97]',
  ghost: 'bg-transparent hover:bg-white/5 text-text-muted hover:text-text-main active:scale-[0.97]',
  danger: 'bg-danger text-white hover:opacity-90 active:scale-[0.97]',
};

const sizes: Record<IconButtonSize, string> = {
  sm: 'h-6 w-6 text-xs p-1',
  compact: 'h-7 w-7 text-xs p-1.5',
  md: 'h-8 w-8 text-sm p-1.5',
  default: 'h-8 w-8 text-sm p-1.5',
  lg: 'h-9 w-9 text-base p-2',
  large: 'h-9 w-9 text-base p-2',
};

const baseStyles =
  'inline-flex items-center justify-center rounded-md font-sans transition-[color,background-color,border-color,opacity,transform] duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-40 disabled:pointer-events-none cursor-pointer select-none';

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
      className={cn(baseStyles, variants[variant], sizes[size], className)}
      disabled={disabled || isLoading}
      aria-label={ariaLabel}
      aria-busy={isLoading ? true : undefined}
      {...props}
    >
      {isLoading ? (
        <svg
          className="h-3.5 w-3.5 animate-spin"
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
        >
          <circle
            className="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="4"
          />
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
          />
        </svg>
      ) : (
        children
      )}
    </Component>
  );
};

export const IconButton = memo(IconButtonComponent) as typeof IconButtonComponent;
