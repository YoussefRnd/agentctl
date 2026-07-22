export interface ReviewFile {
  path: string;
  state: 'untracked' | 'staged' | 'modified' | 'deleted' | 'committed' | 'conflicted';
  diff: string;
}

export function parseMultiFileDiff(diffOutput: string): Map<string, string> {
  const fileDiffs = new Map<string, string>();
  if (!diffOutput) return fileDiffs;

  const lines = diffOutput.split('\n');
  let currentFile: string | null = null;
  let currentDiffLines: string[] = [];

  for (const line of lines) {
    if (line.startsWith('diff --git a/')) {
      if (currentFile && currentDiffLines.length > 0) {
        fileDiffs.set(currentFile, currentDiffLines.join('\n'));
      }
      const parts = line.substring(13).split(' b/');
      if (parts.length >= 2) {
        currentFile = parts[0];
      } else {
        currentFile = null;
      }
      currentDiffLines = [line];
    } else {
      if (currentFile) {
        currentDiffLines.push(line);
      }
    }
  }

  if (currentFile && currentDiffLines.length > 0) {
    fileDiffs.set(currentFile, currentDiffLines.join('\n'));
  }

  return fileDiffs;
}
