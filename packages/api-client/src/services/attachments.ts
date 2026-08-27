import { ApiError } from '../api-error.js';
import { redirectToLogin, getApiBaseUrl, getAuthToken } from '../api-client.js';

export interface UploadAttachmentResult {
  attachmentId: string;
  mimeType: string;
  filename: string;
  sizeBytes: number;
}

const ALLOWED_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

const MAX_SIZE_BYTES = 20 * 1024 * 1024; // 20 MB

/**
 * Upload a single image file to the session attachment store.
 * Uses XMLHttpRequest so upload progress can be tracked.
 */
export function uploadAttachment(
  sessionId: string,
  file: File,
  onProgress?: (pct: number) => void,
): Promise<UploadAttachmentResult> {
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
    const baseUrl = getApiBaseUrl();
    const url = `${baseUrl}/api/sessions/${sessionId}/attachments`;

    xhr.open('POST', url);
    xhr.withCredentials = true;

    const token = getAuthToken();
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
        redirectToLogin();
        reject(new ApiError('Unauthorized', 401));
        return;
      }

      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const data = JSON.parse(xhr.responseText) as UploadAttachmentResult;
          onProgress?.(100);
          resolve(data);
        } catch {
          reject(new ApiError('Invalid response from server', 500));
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

      reject(new ApiError(message, xhr.status));
    };

    xhr.onerror = () => {
      reject(new ApiError('Network error during upload', 0));
    };

    xhr.onabort = () => {
      reject(new ApiError('Upload aborted', 0));
    };

    xhr.send(file);
  });
}
