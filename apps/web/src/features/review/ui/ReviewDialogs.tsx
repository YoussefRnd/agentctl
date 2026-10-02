import { ConfirmationModal } from '@agentctl/ui';
import { ApplySessionDialog } from './ApplySessionDialog';
import { CreatePullRequestDialog } from './CreatePullRequestDialog';

interface ReviewDialogsProps {
  sessionId: string;
  isDiscardModalOpen: boolean;
  isApplyDialogOpen: boolean;
  isPullRequestDialogOpen: boolean;
  commitMessage: string;
  isDiscarding: boolean;
  defaultBaseBranch?: string;
  currentBranch?: string;
  defaultTitle?: string;
  onCloseDiscardModal: () => void;
  onConfirmDiscard: () => Promise<void>;
  onSetApplyDialogOpen: (open: boolean) => void;
  onSetPullRequestDialogOpen: (open: boolean) => void;
  onCommitMessageChange: (val: string) => void;
  onConfirmApply: () => Promise<void>;
  onPullRequestSuccess?: (url: string, created: boolean) => void;
}

export function ReviewDialogs({
  sessionId,
  isDiscardModalOpen,
  isApplyDialogOpen,
  isPullRequestDialogOpen,
  commitMessage,
  isDiscarding,
  defaultBaseBranch,
  currentBranch,
  defaultTitle,
  onCloseDiscardModal,
  onConfirmDiscard,
  onSetApplyDialogOpen,
  onSetPullRequestDialogOpen,
  onCommitMessageChange,
  onConfirmApply,
  onPullRequestSuccess,
}: ReviewDialogsProps) {
  return (
    <>
      <ConfirmationModal
        isOpen={isDiscardModalOpen}
        title="Discard all changes?"
        message="Discard this session’s changes and finish the session. A recovery copy will be kept until you delete the session."
        confirmText="Discard Changes"
        cancelText="Cancel"
        type="brand-red"
        onConfirm={onConfirmDiscard}
        onCancel={onCloseDiscardModal}
        isConfirming={isDiscarding}
      />

      <ApplySessionDialog
        open={isApplyDialogOpen}
        onOpenChange={onSetApplyDialogOpen}
        baseBranch={defaultBaseBranch ?? 'main'}
        commitMessage={commitMessage}
        onCommitMessageChange={onCommitMessageChange}
        onConfirm={onConfirmApply}
      />

      <CreatePullRequestDialog
        open={isPullRequestDialogOpen}
        onOpenChange={onSetPullRequestDialogOpen}
        sessionId={sessionId}
        defaultTitle={defaultTitle}
        defaultBaseBranch={defaultBaseBranch}
        currentBranch={currentBranch}
        onSuccess={onPullRequestSuccess}
      />
    </>
  );
}
