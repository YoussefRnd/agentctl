import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';

const attachmentSchema = z.object({
  attachmentId: z.string(),
  mimeType: z.string(),
  filename: z.string(),
  sizeBytes: z
    .number()
    .int()
    .nonnegative()
    .max(20 * 1024 * 1024),
});

/** Resolve before acceptance, and again before dispatch in case files disappeared. */
export async function resolveMessageAttachments(sessionId: string, ids: string[] = []) {
  if (ids.length > 20 || new Set(ids).size !== ids.length)
    throw new Error('Invalid attachment selection');
  const directory = path.join(os.tmpdir(), 'agentctl-attachments', sessionId);
  const metadata: z.infer<typeof attachmentSchema>[] = [];
  const files: { filePath: string; mimeType: string }[] = [];
  for (const id of ids) {
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(id)) throw new Error('Invalid attachment ID');
    try {
      const item = attachmentSchema.parse(
        JSON.parse(await fs.readFile(path.join(directory, `${id}.json`), 'utf8')),
      );
      const filePath = path.join(directory, `${id}.bin`);
      const stat = await fs.stat(filePath);
      if (item.attachmentId !== id || !stat.isFile() || stat.size !== item.sizeBytes)
        throw new Error('Invalid attachment');
      metadata.push(item);
      files.push({ filePath, mimeType: item.mimeType });
    } catch {
      throw new Error(
        'An attachment is unavailable. Reattach the files and send the message again.',
      );
    }
  }
  if (metadata.reduce((total, item) => total + item.sizeBytes, 0) > 20 * 1024 * 1024)
    throw new Error('Attachments exceed the message size limit');
  return { metadata, files };
}
