import { memo } from 'react';
import type { ElementType, ComponentPropsWithoutRef, ReactNode } from 'react';
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
  solid: 'bg-accent text-brand-crust hover:opacity-90 active:scale-[0.97]',
  outline:
    'bg-transparent border border-border hover:bg-white/5 text-text-main active:scale-[0.97]',
  ghost: 'bg-transparent hover:bg-white/5 text-text-muted hover:text-text-main active:scale-[0.97]',
  danger: 'bg-danger text-white hover:opacity-90 active:scale-[0.97]',
};

const sizes: Record<ButtonSize, string> = {
  sm: 'px-2.5 py-1 text-[11px] h-7',
  compact: 'px-2.5 py-1 text-[11px] h-7',
  md: 'px-3.5 py-1.5 text-[12px] h-8',
  default: 'px-3.5 py-1.5 text-[12px] h-8',
  lg: 'px-5 py-2 text-[14px] h-9',
  large: 'px-5 py-2 text-[14px] h-9',
};

const baseStyles =
  'inline-flex items-center justify-center gap-1.5 rounded-md font-sans font-bold tracking-tight transition-[color,background-color,border-color,opacity,transform] duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-40 disabled:pointer-events-none cursor-pointer select-none';

const ButtonComponent = <T extends ElementType = 'button'>({
  as,
  variant = 'solid',
  size = 'default',
  isLoading = false,
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
      {isLoading ? (
        <span className="flex items-center gap-1.5">
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
          {children}
        </span>
      ) : (
        children
      )}
    </Component>
  );
};

export const Button = memo(ButtonComponent) as typeof ButtonComponent;
