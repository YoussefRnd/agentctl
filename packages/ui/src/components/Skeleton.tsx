import React from 'react';

interface SkeletonProps {
  className?: string;
}

export const Skeleton = ({ className = '' }: SkeletonProps) => {
  return (
    <div className={`animate-pulse rounded-md border border-white/5 bg-white/5 ${className}`} />
  );
};
