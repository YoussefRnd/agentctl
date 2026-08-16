import fs from 'node:fs';
import type { ContentBlock } from '@agentclientprotocol/sdk';

export interface PromptBuildParams {
  text: string;
  attachments?: { filePath: string; mimeType: string }[];
  embeddedContext?: string;
  supportsImage?: boolean;
  supportsAudio?: boolean;
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
      });
    } else {
      const combinedText = params.text
        ? `${params.text}\n\n---\n${params.embeddedContext}`
        : params.embeddedContext;
      promptParts.push({ type: 'text', text: combinedText });
    }
  } else if (params.text) {
    promptParts.push({ type: 'text', text: params.text });
  }

  for (const attachment of params.attachments ?? []) {
    const isAudio = attachment.mimeType.startsWith('audio/');
    const isImage = attachment.mimeType.startsWith('image/');

    if (!isAudio && !isImage) {
      throw new Error(`Unsupported ACP attachment type: ${attachment.mimeType}`);
    }
    if (isAudio && !params.supportsAudio) {
      throw new Error('The ACP agent does not advertise audio prompt support');
    }
    if (isImage && !params.supportsImage) {
      throw new Error('The ACP agent does not advertise image prompt support');
    }

    const data = fs.readFileSync(attachment.filePath).toString('base64');
    if (isAudio) {
      promptParts.push({ type: 'audio', data, mimeType: attachment.mimeType });
    } else {
      promptParts.push({ type: 'image', data, mimeType: attachment.mimeType });
    }
  }

  return promptParts;
}
