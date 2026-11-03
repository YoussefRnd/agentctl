import type { ReactNode } from 'react';

interface FeedbackContentProps {
  title: string;
  description?: string;
  action?: ReactNode;
  descriptionClassName: string;
}

/** Shared slots only: the owning state retains its original surface, icon and spacing. */
export function FeedbackContent({
  title,
  description,
  action,
  descriptionClassName,
}: FeedbackContentProps) {
  return (
    <>
      <h3 className="text-role-title text-text-main">{title}</h3>
      {description && <p className={descriptionClassName}>{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </>
  );
}
