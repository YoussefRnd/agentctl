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
    solid: 'bg-white text-black hover:bg-zinc-200',
    outline: 'bg-transparent border border-white/10 hover:bg-white/5 text-white',
    ghost: 'bg-transparent hover:bg-white/5 text-zinc-400 hover:text-white',
  };

  const sizes = {
    sm: 'px-2 py-1 text-[10px]',
    md: 'px-3 py-1.5 text-[11px]',
    lg: 'px-4 py-2 text-[13px]',
  };

  const baseStyles =
    'inline-flex items-center justify-center rounded-sm font-bold uppercase tracking-tight transition-all focus:outline-none focus:ring-1 focus:ring-white/20 disabled:opacity-30 disabled:pointer-events-none cursor-pointer';

  const combinedClassName = `${baseStyles} ${variants[variant]} ${sizes[size]} ${className}`.trim();

  return (
    <Component className={combinedClassName} {...props}>
      {children}
    </Component>
  );
};

