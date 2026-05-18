import type { ReactNode } from "react";
import React from "react";

interface CardProps {
  children: ReactNode;
  className?: string;
}

export const Card = ({ children, className = "" }: CardProps) => {
  return (
    <div
      className={`liquid-glass rounded-xl overflow-hidden transition-all duration-300 hover:border-white/20 ${className}`}
    >
      {children}
    </div>
  );
};

export const CardHeader = ({ children, className = "" }: CardProps) => (
  <div className={`px-4 py-3 border-b border-border bg-glass-surface ${className}`}>
    {children}
  </div>
);

export const CardContent = ({ children, className = "" }: CardProps) => (
  <div className={`px-4 py-4 ${className}`}>{children}</div>
);

export const CardFooter = ({ children, className = "" }: CardProps) => (
  <div className={`px-4 py-3 border-t border-border bg-glass-surface/50 ${className}`}>
    {children}
  </div>
);
