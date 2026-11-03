import { getErrorMessage } from '@/shared/lib/feedback';
import { useCallback, useEffect, useRef, useState } from 'react';
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
  retryAttachment: (localId: string) => void;
  clearAll: () => void;
  readyAttachmentIds: string[];
  isAnyUploading: boolean;
  pendingFiles: File[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ALLOWED_MIME_TYPES = new Set<string>(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

const MAX_SIZE_BYTES = 20 * 1024 * 1024; // 20 MB

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useAttachments(sessionId: string, initialFiles: File[] = []): UseAttachmentsReturn {
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const initialFilesRef = useRef(initialFiles);
  const uploads = useRef(new Map<string, AbortController>());

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  /** Immutably patch a single attachment by localId. */
  const patchAttachment = useCallback((localId: string, patch: Partial<PendingAttachment>) => {
    setAttachments((prev) => prev.map((a) => (a.localId === localId ? { ...a, ...patch } : a)));
  }, []);

  // -------------------------------------------------------------------------
  // uploadFile — shared by addFiles and retryAttachment
  // -------------------------------------------------------------------------

  const uploadFile = useCallback(
    (localId: string, file: File) => {
      uploads.current.get(localId)?.abort();
      const controller = new AbortController();
      uploads.current.set(localId, controller);
      patchAttachment(localId, { state: 'uploading', progress: 0, errorMessage: undefined });

      uploadAttachment(
        sessionId,
        file,
        (pct: number) => {
          if (!controller.signal.aborted) patchAttachment(localId, { progress: pct });
        },
        controller.signal,
      )
        .then(({ attachmentId }: { attachmentId: string }) => {
          if (controller.signal.aborted) return;
          patchAttachment(localId, {
            state: 'ready',
            attachmentId,
            progress: 100,
          });
        })
        .catch((err: unknown) => {
          if (controller.signal.aborted) return;
          const errorMessage = getErrorMessage(err, 'Upload failed');
          patchAttachment(localId, { state: 'error', errorMessage });
        })
        .finally(() => {
          if (uploads.current.get(localId) === controller) uploads.current.delete(localId);
        });
    },
    [sessionId, patchAttachment],
  );

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
          state: sessionId ? 'uploading' : 'ready',
          progress: sessionId ? 0 : 100,
        };

        newAttachments.push(attachment);
      }

      if (newAttachments.length === 0) return;

      setAttachments((prev) => [...prev, ...newAttachments]);

      // Kick off uploads after state is committed.
      for (const attachment of newAttachments) {
        if (sessionId) uploadFile(attachment.localId, attachment.file);
      }
    },
    [uploadFile, sessionId],
  );

  // -------------------------------------------------------------------------
  // retryAttachment
  // -------------------------------------------------------------------------

  const retryAttachment = useCallback(
    (localId: string) => {
      const target = attachments.find((a) => a.localId === localId);
      if (target && sessionId) {
        uploadFile(target.localId, target.file);
      }
    },
    [attachments, uploadFile, sessionId],
  );

  // -------------------------------------------------------------------------
  // removeAttachment
  // -------------------------------------------------------------------------

  const removeAttachment = useCallback((localId: string) => {
    uploads.current.get(localId)?.abort();
    uploads.current.delete(localId);
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
    for (const controller of uploads.current.values()) controller.abort();
    uploads.current.clear();
    setAttachments((prev) => {
      for (const attachment of prev) {
        URL.revokeObjectURL(attachment.objectUrl);
      }
      return [];
    });
  }, []);

  const attachmentsRef = useRef(attachments);

  useEffect(() => {
    attachmentsRef.current = attachments;
  }, [attachments]);

  useEffect(() => {
    const restored: PendingAttachment[] = initialFilesRef.current.map((file) => ({
      localId: crypto.randomUUID(),
      file,
      objectUrl: URL.createObjectURL(file),
      mimeType: file.type,
      sizeBytes: file.size,
      state: 'ready',
      progress: 100,
    }));
    attachmentsRef.current = restored;
    setAttachments(restored);
    return () => {
      for (const controller of uploads.current.values()) controller.abort();
      uploads.current.clear();
      for (const attachment of attachmentsRef.current) URL.revokeObjectURL(attachment.objectUrl);
    };
  }, [sessionId]);

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
    retryAttachment,
    clearAll,
    readyAttachmentIds,
    isAnyUploading,
    pendingFiles: sessionId ? [] : attachments.map((attachment) => attachment.file),
  };
}
