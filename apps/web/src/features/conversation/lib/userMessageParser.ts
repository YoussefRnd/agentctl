export interface ContextAttachment {
  id: string;
  title: string;
  type: 'file' | 'git' | 'folder' | 'text';
  language: string;
  content: string;
  lineCount: number;
}

export interface ParsedUserMessage {
  prompt: string;
  attachments: ContextAttachment[];
}

export function parseUserMessageContent(rawContent: string): ParsedUserMessage {
  if (!rawContent) {
    return { prompt: '', attachments: [] };
  }

  const firstIndex = rawContent.indexOf('### Context Attachment:');
  if (firstIndex === -1) {
    return {
      prompt: rawContent.trim(),
      attachments: [],
    };
  }

  const prompt = rawContent.slice(0, firstIndex).trim();
  const attachmentsPart = rawContent.slice(firstIndex);
  const attachments: ContextAttachment[] = [];

  // Split by "### Context Attachment:" blocks
  const rawBlocks = attachmentsPart.split(/(?=### Context Attachment:)/g);

  for (let i = 0; i < rawBlocks.length; i++) {
    const block = rawBlocks[i]?.trim();
    if (!block || !block.startsWith('### Context Attachment:')) continue;

    const firstLineEnd = block.indexOf('\n');
    const headerLine = firstLineEnd === -1 ? block : block.slice(0, firstLineEnd);
    const body = firstLineEnd === -1 ? '' : block.slice(firstLineEnd + 1).trim();

    const rawTitle = headerLine.replace('### Context Attachment:', '').trim();
    // Clean backticks or quotes from title
    const cleanTitle = rawTitle.replace(/^[`'"]+|[`'"]+$/g, '').trim();

    let type: ContextAttachment['type'] = 'file';
    if (cleanTitle.toLowerCase().includes('git') || cleanTitle.toLowerCase().includes('diff')) {
      type = 'git';
    } else if (cleanTitle.toLowerCase().startsWith('folder ') || cleanTitle.endsWith('/')) {
      type = 'folder';
    }

    let language = 'text';
    let codeContent = body;

    // Check if body is wrapped in a markdown code block ```lang ... ```
    const codeBlockMatch = /^```(\w*)\r?\n([\s\S]*?)\r?\n```$/s.exec(body);
    if (codeBlockMatch) {
      language = codeBlockMatch[1] || 'text';
      codeContent = codeBlockMatch[2] ?? '';
    }

    const lines = codeContent ? codeContent.split('\n').length : 0;

    attachments.push({
      id: `attachment-${String(i)}-${cleanTitle}`,
      title: cleanTitle,
      type,
      language,
      content: codeContent,
      lineCount: lines,
    });
  }

  return {
    prompt,
    attachments,
  };
}
