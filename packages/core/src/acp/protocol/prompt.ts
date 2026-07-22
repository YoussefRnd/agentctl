import fs from 'node:fs';
import type { ContentBlock } from '@agentclientprotocol/sdk';

export interface PromptBuildParams {
  text: string;
  attachments?: { filePath: string; mimeType: string }[];
  embeddedContext?: string;
  supportsEmbeddedContext?: boolean;
}

export function buildPromptBlocks(params: PromptBuildParams): ContentBlock[] {
  const promptParts: ContentBlock[] = [];

  if (params.embeddedContext) {
    if (params.supportsEmbeddedContext) {
      if (params.text) {
        promptParts.push({ type: 'text', text: params.text });
      }
      promptParts.push({
        type: 'resource',
        resource: {
          uri: 'internal://embedded_context',
          text: params.embeddedContext,
          mimeType: 'text/markdown',
        },
      } as unknown as ContentBlock);
    } else {
      const combinedText = params.text
        ? `${params.text}\n\n---\n${params.embeddedContext}`
        : params.embeddedContext;
      promptParts.push({ type: 'text', text: combinedText });
    }
  } else if (params.text) {
    promptParts.push({ type: 'text', text: params.text });
  }

  for (const att of params.attachments ?? []) {
    const data = fs.readFileSync(att.filePath).toString('base64');
    if (att.mimeType.startsWith('audio/')) {
      promptParts.push({
        type: 'audio',
        data,
        mimeType: att.mimeType,
      });
    } else {
      promptParts.push({
        type: 'image',
        data,
        mimeType: att.mimeType,
      });
    }
  }

  return promptParts;
}
