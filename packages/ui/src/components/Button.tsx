import type { ElementType, ComponentPropsWithoutRef, ReactNode } from 'react';

type ButtonVariant = 'ghost' | 'outline' | 'solid';
type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonBaseProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
  children?: ReactNode;
  className?: string;
}

export type ButtonProps<T extends ElementType> = ButtonBaseProps & {
  as?: T;
} & Omit<ComponentPropsWithoutRef<T>, keyof ButtonBaseProps | 'as'>;

export const Button = <T extends ElementType = 'button'>({
  as,
  variant = 'solid',
  size = 'md',
  className = '',
  children,
  ...props
}: ButtonProps<T>) => {
  const Component = as ?? 'button';

  const variants = {
    solid: 'bg-accent text-white hover:bg-accent-hover shadow-lg shadow-accent-glow',
    outline:
      'bg-transparent border border-border hover:bg-glass-surface text-text-main backdrop-blur-md',
    ghost:
      'bg-transparent hover:bg-glass-surface text-text-muted hover:text-text-main backdrop-blur-md',
  };

  const sizes = {
    sm: 'px-3 py-1.5 text-xs-caps',
    md: 'px-4 py-2 text-sm-label',
    lg: 'px-6 py-3 text-base',
  };

  const baseStyles =
    'inline-flex items-center justify-center rounded-lg font-medium transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-accent/50 disabled:opacity-50 disabled:pointer-events-none cursor-pointer';

  const combinedClassName = `${baseStyles} ${variants[variant]} ${sizes[size]} ${className}`.trim();

  return (
    <Component className={combinedClassName} {...props}>
      {children}
    </Component>
  );
};
