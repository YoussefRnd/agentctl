import { z } from 'zod';
export const attachmentSchema = z.object({
  attachmentId: z.string(),
  mimeType: z.string(),
  filename: z.string(),
  sizeBytes: z.number(),
});
export type UploadAttachmentResult = z.infer<typeof attachmentSchema>;
