import { ApiError } from '../api-error.js';
import { notifyUnauthorized, getApiBaseUrl, getDesktopCapability } from '../http/configuration.js';

import { attachmentSchema, type UploadAttachmentResult } from '@agentctl/shared';
export type { UploadAttachmentResult } from '@agentctl/shared';

const ALLOWED_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

const MAX_SIZE_BYTES = 20 * 1024 * 1024; // 20 MB

/** Fetch image bytes using the same backend and authentication as uploads. */
export async function fetchAttachment(
  sessionId: string,
  attachmentId: string,
  signal?: AbortSignal,
): Promise<Blob> {
  const token = getDesktopCapability();
  const response = await fetch(
    `${getApiBaseUrl()}/api/sessions/${encodeURIComponent(sessionId)}/attachments/${encodeURIComponent(attachmentId)}`,
    {
      credentials: 'include',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      signal,
    },
  );
  if (response.status === 401) notifyUnauthorized();
  if (!response.ok) {
    throw new ApiError('Could not load image attachment', response.status);
  }
  const blob = await response.blob();
  if (!ALLOWED_TYPES.has(blob.type)) {
    throw new ApiError('Invalid image attachment response', 415);
  }
  return blob;
}

/**
 * Upload a single image file to the session attachment store.
 * Uses XMLHttpRequest so upload progress can be tracked.
 */
export function uploadAttachment(
  sessionId: string,
  file: File,
  onProgress?: (pct: number) => void,
  signal?: AbortSignal,
): Promise<UploadAttachmentResult> {
  if (signal?.aborted) return Promise.reject(new DOMException('Upload aborted', 'AbortError'));
  if (!ALLOWED_TYPES.has(file.type)) {
    return Promise.reject(
      new ApiError(`Unsupported file type: ${file.type}. Allowed: PNG, JPEG, GIF, WebP.`, 415),
    );
  }

  if (file.size > MAX_SIZE_BYTES) {
    return Promise.reject(
      new ApiError(`File too large: ${file.name} exceeds the 20 MB limit.`, 413),
    );
  }

  return new Promise<UploadAttachmentResult>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const cleanup = () => {
      signal?.removeEventListener('abort', abort);
    };
    const succeed = (value: UploadAttachmentResult) => {
      cleanup();
      resolve(value);
    };
    const fail = (error: unknown) => {
      cleanup();
      reject(error);
    };
    const abort = () => {
      xhr.abort();
      fail(new DOMException('Upload aborted', 'AbortError'));
    };

    const baseUrl = getApiBaseUrl();
    const url = `${baseUrl}/api/sessions/${sessionId}/attachments`;

    xhr.open('POST', url);
    xhr.withCredentials = true;

    const token = getDesktopCapability();
    if (token) {
      xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    }

    xhr.setRequestHeader('Content-Type', file.type);
    xhr.setRequestHeader('X-Filename', encodeURIComponent(file.name));

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    };

    xhr.onload = () => {
      if (xhr.status === 401) {
        notifyUnauthorized();
        fail(new ApiError('Unauthorized', 401));
        return;
      }

      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const data = attachmentSchema.parse(JSON.parse(xhr.responseText));
          onProgress?.(100);
          succeed(data);
        } catch {
          fail(new ApiError('Invalid response from server', 500));
        }
        return;
      }

      let message = xhr.statusText;
      try {
        const body = JSON.parse(xhr.responseText) as { error?: string; message?: string };
        if (typeof body.error === 'string') message = body.error;
        else if (typeof body.message === 'string') message = body.message;
      } catch {
        // keep statusText
      }

      fail(new ApiError(message, xhr.status));
    };

    xhr.onerror = () => {
      fail(new ApiError('Network error during upload', 0));
    };

    xhr.onabort = () => {
      fail(
        signal?.aborted
          ? new DOMException('Upload aborted', 'AbortError')
          : new ApiError('Upload aborted', 0),
      );
    };

    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) {
      abort();
      return;
    }
    try {
      xhr.send(file);
    } catch (error) {
      fail(error);
    }
  });
}
