import { ConfirmationModal } from '@agentctl/ui';
import { ReviewMergeDialog } from './ReviewMergeDialog';

interface ReviewDialogsProps {
  isDiscardModalOpen: boolean;
  isMergeDialogOpen: boolean;
  commitMessage: string;
  onCloseDiscardModal: () => void;
  onConfirmDiscard: () => void;
  onSetMergeDialogOpen: (open: boolean) => void;
  onCommitMessageChange: (val: string) => void;
  onConfirmMerge: () => void;
}

export function ReviewDialogs({
  isDiscardModalOpen,
  isMergeDialogOpen,
  commitMessage,
  onCloseDiscardModal,
  onConfirmDiscard,
  onSetMergeDialogOpen,
  onCommitMessageChange,
  onConfirmMerge,
}: ReviewDialogsProps) {
  return (
    <>
      <ConfirmationModal
        isOpen={isDiscardModalOpen}
        title="Discard all changes?"
        message="This will permanently revert all modifications in this workspace. This action cannot be undone."
        confirmText="Discard Changes"
        cancelText="Cancel"
        type="brand-red"
        onConfirm={onConfirmDiscard}
        onCancel={onCloseDiscardModal}
      />

      <ReviewMergeDialog
        open={isMergeDialogOpen}
        onOpenChange={onSetMergeDialogOpen}
        commitMessage={commitMessage}
        onCommitMessageChange={onCommitMessageChange}
        onCancel={() => onSetMergeDialogOpen(false)}
        onConfirm={onConfirmMerge}
      />
    </>
  );
}
