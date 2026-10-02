export type { ReviewFile } from '@agentctl/shared';

/** Parse NUL-delimited status so whitespace and quoted/non-ASCII paths stay literal. */
export function parseFileStatus(output: string) {
  const fields = output.split('\0');
  const files: { path: string; index: string; working_dir: string; conflicted: boolean }[] = [];
  for (let i = 0; i < fields.length; i++) {
    const record = fields[i];
    if (!record || record.length < 4) continue;
    const code = record.slice(0, 2);
    files.push({
      path: record.slice(3),
      index: code[0],
      working_dir: code[1],
      conflicted: ['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU'].includes(code),
    });
    if (code.includes('R') || code.includes('C')) {
      const oldPath = fields[++i];
      if (oldPath && code.includes('R'))
        files.push({
          path: oldPath,
          index: code[0] === 'R' ? 'D' : ' ',
          working_dir: code[1] === 'R' ? 'D' : ' ',
          conflicted: false,
        });
    }
  }
  return files;
}
