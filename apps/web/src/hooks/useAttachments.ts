import { useCallback, useEffect, useState } from 'react';
import { uploadAttachment } from '@agentctl/api-client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PendingAttachment {
  localId: string;
  file: File;
  objectUrl: string;
  mimeType: string;
  sizeBytes: number;
  state: 'uploading' | 'ready' | 'error';
  progress: number;
  attachmentId?: string;
  errorMessage?: string;
}

export interface UseAttachmentsReturn {
  attachments: PendingAttachment[];
  addFiles: (files: FileList | File[]) => void;
  removeAttachment: (localId: string) => void;
  clearAll: () => void;
  readyAttachmentIds: string[];
  isAnyUploading: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ALLOWED_MIME_TYPES = new Set<string>(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

const MAX_SIZE_BYTES = 20 * 1024 * 1024; // 20 MB

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useAttachments(sessionId: string): UseAttachmentsReturn {
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  /** Immutably patch a single attachment by localId. */
  const patchAttachment = useCallback((localId: string, patch: Partial<PendingAttachment>) => {
    setAttachments((prev) => prev.map((a) => (a.localId === localId ? { ...a, ...patch } : a)));
  }, []);

  // -------------------------------------------------------------------------
  // addFiles
  // -------------------------------------------------------------------------

  const addFiles = useCallback(
    (files: FileList | File[]) => {
      const fileArray = Array.from(files);

      const newAttachments: PendingAttachment[] = [];

      for (const file of fileArray) {
        // Validation — silently skip invalid files.
        if (!ALLOWED_MIME_TYPES.has(file.type)) continue;
        if (file.size > MAX_SIZE_BYTES) continue;

        const localId = crypto.randomUUID();
        const objectUrl = URL.createObjectURL(file);

        const attachment: PendingAttachment = {
          localId,
          file,
          objectUrl,
          mimeType: file.type,
          sizeBytes: file.size,
          state: 'uploading',
          progress: 0,
        };

        newAttachments.push(attachment);
      }

      if (newAttachments.length === 0) return;

      setAttachments((prev) => [...prev, ...newAttachments]);

      // Kick off uploads after state is committed.
      for (const attachment of newAttachments) {
        const { localId, file } = attachment;

        uploadAttachment(sessionId, file, (pct: number) => {
          patchAttachment(localId, { progress: pct });
        })
          .then(({ attachmentId }: { attachmentId: string }) => {
            patchAttachment(localId, {
              state: 'ready',
              attachmentId,
              progress: 100,
            });
          })
          .catch((err: unknown) => {
            const errorMessage = err instanceof Error ? err.message : 'Upload failed';
            patchAttachment(localId, { state: 'error', errorMessage });
          });
      }
    },
    [sessionId, patchAttachment],
  );

  // -------------------------------------------------------------------------
  // removeAttachment
  // -------------------------------------------------------------------------

  const removeAttachment = useCallback((localId: string) => {
    setAttachments((prev) => {
      const target = prev.find((a) => a.localId === localId);
      if (target) {
        URL.revokeObjectURL(target.objectUrl);
      }
      return prev.filter((a) => a.localId !== localId);
    });
  }, []);

  // -------------------------------------------------------------------------
  // clearAll
  // -------------------------------------------------------------------------

  const clearAll = useCallback(() => {
    setAttachments((prev) => {
      for (const attachment of prev) {
        URL.revokeObjectURL(attachment.objectUrl);
      }
      return [];
    });
  }, []);

  // -------------------------------------------------------------------------
  const [prevSessionId, setPrevSessionId] = useState(sessionId);

  if (sessionId !== prevSessionId) {
    setPrevSessionId(sessionId);
    // Revoke old URLs
    for (const attachment of attachments) {
      URL.revokeObjectURL(attachment.objectUrl);
    }
    setAttachments([]);
  }

  // Cleanup — revoke remaining objectUrls on unmount.
  // -------------------------------------------------------------------------

  useEffect(() => {
    return () => {
      setAttachments((prev) => {
        for (const attachment of prev) {
          URL.revokeObjectURL(attachment.objectUrl);
        }
        return prev;
      });
    };
  }, []);

  // -------------------------------------------------------------------------
  // Derived state
  // -------------------------------------------------------------------------

  const readyAttachmentIds = attachments
    .map((a) => a.attachmentId)
    .filter((id): id is string => id !== undefined);

  const isAnyUploading = attachments.some((a) => a.state === 'uploading');

  // -------------------------------------------------------------------------

  return {
    attachments,
    addFiles,
    removeAttachment,
    clearAll,
    readyAttachmentIds,
    isAnyUploading,
  };
}
