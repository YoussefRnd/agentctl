import type { ReactNode } from 'react';
import type { SessionEventApprovalRequestData } from '@agentctl/shared';
import { ApprovalCard } from './cards/ApprovalCard';

interface ApprovalComposerSlotProps {
  approval?: {
    id: number;
    data: SessionEventApprovalRequestData;
  };
  onApprove: (eventId: number, optionId?: string) => void;
  onDeny: (eventId: number) => void;
  children: ReactNode;
}

export function ApprovalComposerSlot({
  approval,
  onApprove,
  onDeny,
  children,
}: ApprovalComposerSlotProps) {
  return (
    <>
      {approval && (
        <ApprovalCard
          key={approval.id}
          eventId={approval.id}
          data={approval.data}
          onApprove={onApprove}
          onDeny={onDeny}
        />
      )}
      <div hidden={!!approval} aria-hidden={!!approval} className="w-full">
        {children}
      </div>
    </>
  );
}
