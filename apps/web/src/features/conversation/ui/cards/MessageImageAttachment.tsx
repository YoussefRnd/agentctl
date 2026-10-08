import { useEffect, useState } from 'react';
import { fetchAttachment, type UploadAttachmentResult } from '@agentctl/api-client';
import { ImagePreview } from '@agentctl/ui';

type ImageState = { status: 'loading' | 'error' } | { status: 'ready'; url: string };

export function MessageImageAttachment({
  sessionId,
  attachment,
}: {
  sessionId: string;
  attachment: UploadAttachmentResult;
}) {
  const [image, setImage] = useState<ImageState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let objectUrl: string | undefined;
    setImage({ status: 'loading' });
    void fetchAttachment(sessionId, attachment.attachmentId, controller.signal)
      .then((blob) => {
        if (controller.signal.aborted) return;
        objectUrl = URL.createObjectURL(blob);
        setImage({ status: 'ready', url: objectUrl });
      })
      .catch(() => {
        if (!controller.signal.aborted) setImage({ status: 'error' });
      });
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [sessionId, attachment.attachmentId, attempt]);

  return (
    <ImagePreview
      src={image.status === 'ready' ? image.url : undefined}
      filename={attachment.filename}
      status={image.status}
      showFilename
      className="w-56"
      imageClassName="h-40"
      onRetry={() => setAttempt((value) => value + 1)}
      onImageError={() => setImage({ status: 'error' })}
    />
  );
}
