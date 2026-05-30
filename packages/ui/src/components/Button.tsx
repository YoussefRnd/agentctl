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
    solid: 'bg-accent text-background hover:bg-accent/90',
    outline: 'bg-transparent border border-accent/20 hover:bg-accent/5 text-accent-secondary',
    ghost: 'bg-transparent hover:bg-accent/5 text-text-muted hover:text-accent',
  };

  const sizes = {
    sm: 'px-3 py-1 text-[11px]',
    md: 'px-4 py-1.5 text-[12px]',
    lg: 'px-6 py-2.5 text-[14px]',
  };

  const baseStyles =
    'inline-flex items-center justify-center rounded-md font-accent font-bold uppercase tracking-wider transition-all focus:outline-none focus:ring-2 focus:ring-accent/20 disabled:opacity-30 disabled:pointer-events-none cursor-pointer';

  const combinedClassName = `${baseStyles} ${variants[variant]} ${sizes[size]} ${className}`.trim();

  return (
    <Component className={combinedClassName} {...props}>
      {children}
    </Component>
  );
};
