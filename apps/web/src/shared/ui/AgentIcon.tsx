import type { SVGProps } from 'react';

export interface AgentIconProps extends SVGProps<SVGSVGElement> {
  size?: number | string;
  strokeWidth?: number | string;
}

/**
 * AgentCtl signature icon representing an autonomous AI Agent / Model.
 * Geometric Control Node: Precision diamond perimeter enclosing an inner
 * directional node and central execution core.
 */
export function AgentIcon({ size = 24, strokeWidth = 2, className, ...props }: AgentIconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      width={size}
      height={size}
      className={className}
      {...props}
    >
      <path d="M2.7 10.3a2.41 2.41 0 0 0 0 3.41l7.59 7.59a2.41 2.41 0 0 0 3.41 0l7.59-7.59a2.41 2.41 0 0 0 0-3.41l-7.59-7.59a2.41 2.41 0 0 0-3.41 0Z" />
      <path d="M12 7.5 7.5 12 12 16.5 16.5 12Z" strokeWidth={Number(strokeWidth) * 0.75} />
      <circle cx="12" cy="12" r="1.25" fill="currentColor" stroke="none" />
    </svg>
  );
}
