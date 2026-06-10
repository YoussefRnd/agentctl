import React from 'react';
import { cn } from '../utils';

interface SkeletonProps {
  className?: string;
}

export const Skeleton = ({ className }: SkeletonProps) => {
  return (
    <div
      className={cn('bg-surface-secondary/50 animate-pulse rounded-sm', className)}
    />
  );
};
