export const MAX_SYNTAX_LINE_LENGTH = 4 * 1024;

const EXTENSION_MAP: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  py: 'python',
  go: 'go',
  rs: 'rust',
  json: 'json',
  yaml: 'yaml',
  yml: 'yaml',
  md: 'markdown',
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  dockerfile: 'dockerfile',
  css: 'css',
  scss: 'scss',
  html: 'xml',
  xml: 'xml',
  svg: 'xml',
  sql: 'sql',
  c: 'c',
  cpp: 'cpp',
  h: 'c',
  hpp: 'cpp',
  java: 'java',
  php: 'php',
  rb: 'ruby',
  toml: 'ini',
  env: 'ini',
};

export function getLanguageForPath(filePath: string): string | undefined {
  const fileName = filePath.split('/').pop() ?? filePath;
  if (fileName === 'Dockerfile' || fileName.startsWith('Dockerfile.')) return 'dockerfile';
  if (fileName === 'Makefile') return 'makefile';
  const ext = fileName.split('.').pop()?.toLowerCase();
  if (ext && EXTENSION_MAP[ext]) {
    return EXTENSION_MAP[ext];
  }
  return undefined;
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
