import { describe, expect, it } from 'vite-plus/test';
import { parseUserMessageContent } from './userMessageParser';

describe('userMessageParser', () => {
  it('returns clean prompt when there are no attachments', () => {
    const raw = 'what is this for? @.dockerignore';
    const result = parseUserMessageContent(raw);
    expect(result.prompt).toBe('what is this for? @.dockerignore');
    expect(result.attachments).toEqual([]);
  });

  it('separates user prompt and single context attachment', () => {
    const raw = `what is this for?

### Context Attachment: \`.dockerignore\`
\`\`\`txt
node_modules
dist
\`\`\``;

    const result = parseUserMessageContent(raw);
    expect(result.prompt).toBe('what is this for?');
    expect(result.attachments.length).toBe(1);
    expect(result.attachments[0]).toMatchObject({
      title: '.dockerignore',
      type: 'file',
      language: 'txt',
      content: 'node_modules\ndist',
      lineCount: 2,
    });
  });

  it('handles multiple attachments including git diff', () => {
    const raw = `Check this issue:

### Context Attachment: \`src/config.ts\`
\`\`\`ts
export const config = {};
\`\`\`

### Context Attachment: Git Working Tree Diff
\`\`\`diff
+ const foo = 1;
- const foo = 0;
\`\`\``;

    const result = parseUserMessageContent(raw);
    expect(result.prompt).toBe('Check this issue:');
    expect(result.attachments.length).toBe(2);
    expect(result.attachments[0]?.title).toBe('src/config.ts');
    expect(result.attachments[0]?.type).toBe('file');
    expect(result.attachments[1]?.title).toBe('Git Working Tree Diff');
    expect(result.attachments[1]?.type).toBe('git');
    expect(result.attachments[1]?.language).toBe('diff');
  });

  it('handles empty prompt with only attachment', () => {
    const raw = `### Context Attachment: \`.dockerignore\`
\`\`\`txt
node_modules
\`\`\``;

    const result = parseUserMessageContent(raw);
    expect(result.prompt).toBe('');
    expect(result.attachments.length).toBe(1);
    expect(result.attachments[0]?.title).toBe('.dockerignore');
  });
});
