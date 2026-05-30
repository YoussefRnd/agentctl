import React from 'react';

interface SkeletonProps {
  className?: string;
}

export const Skeleton = ({ className = '' }: SkeletonProps) => {
  return <div className={`bg-surface-secondary/50 animate-pulse rounded-sm ${className}`} />;
};
