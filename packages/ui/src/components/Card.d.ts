import type { ReactNode } from 'react';
interface CardProps {
  children: ReactNode;
  className?: string;
}
export declare const Card: ({
  children,
  className,
}: CardProps) => import('react/jsx-runtime').JSX.Element;
export declare const CardHeader: ({
  children,
  className,
}: CardProps) => import('react/jsx-runtime').JSX.Element;
export declare const CardContent: ({
  children,
  className,
}: CardProps) => import('react/jsx-runtime').JSX.Element;
export declare const CardFooter: ({
  children,
  className,
}: CardProps) => import('react/jsx-runtime').JSX.Element;
export {};
