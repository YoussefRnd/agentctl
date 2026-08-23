import { ConfirmationModal } from '@agentctl/ui';

interface SessionHeaderDialogsProps {
  isArchiving: boolean;
  setIsArchiving: (archiving: boolean) => void;
  handleArchive: () => void;
  isDeleting: boolean;
  setIsDeleting: (deleting: boolean) => void;
  handleDelete: () => void;
  sessionDisplayTitle: string;
}

export function SessionHeaderDialogs({
  isArchiving,
  setIsArchiving,
  handleArchive,
  isDeleting,
  setIsDeleting,
  handleDelete,
  sessionDisplayTitle,
}: SessionHeaderDialogsProps) {
  return (
    <>
      {isArchiving && (
        <ConfirmationModal
          isOpen={isArchiving}
          onCancel={() => {
            setIsArchiving(false);
          }}
          onConfirm={() => {
            void handleArchive();
          }}
          title="Archive Session"
          message={`Are you sure you want to archive "${sessionDisplayTitle}"? It will be hidden from the active sidebar.`}
          confirmText="Archive"
          type="brand-peach"
        />
      )}

      {isDeleting && (
        <ConfirmationModal
          isOpen={isDeleting}
          onCancel={() => {
            setIsDeleting(false);
          }}
          onConfirm={() => {
            void handleDelete();
          }}
          title="Delete Session"
          message={`Are you sure you want to permanently delete "${sessionDisplayTitle}"? This cannot be undone.`}
          confirmText="Delete"
          type="brand-red"
        />
      )}
    </>
  );
}
