import * as React from 'react';
import { FeedbackContent } from '../FeedbackContent.js';
import { cn } from '../../utils.js';

export interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}

export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'text-text-muted flex flex-col items-center justify-center p-8 text-center',
        className,
      )}
    >
      {icon && <div className="text-text-muted/60 mb-3">{icon}</div>}
      <FeedbackContent
        title={title}
        description={description}
        action={action}
        descriptionClassName="text-role-body text-text-muted/80 mt-1 max-w-sm"
      />
    </div>
  );
}
