import type { ReactNode } from 'react';
import React from 'react';

interface CardProps {
 children: ReactNode;
 className?: string;
}

export const Card = ({ children, className = '' }: CardProps) => {
 return (
  <div
   className={`glass-card overflow-hidden transition-all duration-200 hover:border-accent/20 ${className}`}
  >
   {children}
  </div>
 );
};

export const CardHeader = ({ children, className = '' }: CardProps) => (
 <div className={`border-border bg-surface-secondary/50 border-b px-2 py-1.5 ${className}`}>
  {children}
 </div>
);

export const CardContent = ({ children, className = '' }: CardProps) => (
 <div className={`p-2 ${className}`}>{children}</div>
);

export const CardFooter = ({ children, className = '' }: CardProps) => (
 <div className={`border-border bg-surface-tertiary/30 border-t px-2 py-1.5 ${className}`}>
  {children}
 </div>
);

