import React from "react";

interface SkeletonProps {
  className?: string;
}

export const Skeleton = ({ className = "" }: SkeletonProps) => {
  return (
    <div
      className={`animate-pulse rounded-md bg-white/5 border border-white/5 ${className}`}
    />
  );
};
