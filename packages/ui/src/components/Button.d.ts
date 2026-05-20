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
export declare const Button: <T extends ElementType = 'button'>({
  as,
  variant,
  size,
  className,
  children,
  ...props
}: ButtonProps<T>) => import('react/jsx-runtime').JSX.Element;
export {};
