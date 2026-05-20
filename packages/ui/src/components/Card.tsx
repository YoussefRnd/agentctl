import type { ReactNode } from 'react';
import React from 'react';

interface CardProps {
  children: ReactNode;
  className?: string;
}

export const Card = ({ children, className = '' }: CardProps) => {
  return (
    <div
      className={`liquid-glass overflow-hidden rounded-xl transition-all duration-300 hover:border-white/20 ${className}`}
    >
      {children}
    </div>
  );
};

export const CardHeader = ({ children, className = '' }: CardProps) => (
  <div className={`border-border bg-glass-surface border-b px-4 py-3 ${className}`}>{children}</div>
);

export const CardContent = ({ children, className = '' }: CardProps) => (
  <div className={`px-4 py-4 ${className}`}>{children}</div>
);

export const CardFooter = ({ children, className = '' }: CardProps) => (
  <div className={`border-border bg-glass-surface/50 border-t px-4 py-3 ${className}`}>
    {children}
  </div>
);
