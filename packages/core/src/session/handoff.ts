import fs from 'node:fs/promises';
import { getHandoffRetentionMs } from '../config/runtime-defaults.js';

export function redactSensitiveText(text: string): string {
  if (!text) return text;
  return text
    .replace(/(?:sk-|ant-|ghp_|gho_|github_pat_)[a-zA-Z0-9_-]{16,}/g, '[REDACTED_API_KEY]')
    .replace(/Bearer\s+[a-zA-Z0-9._-]{20,}/gi, 'Bearer [REDACTED_TOKEN]')
    .replace(
      /(["']?(?:password|passwd|secret|api_key|token|auth)["']?\s*[:=]\s*["'])([^"'\s]{4,})(["'])/gi,
      '$1[REDACTED]$3',
    );
}

export function scheduleHandoffCleanup(filePath: string, delayMs = getHandoffRetentionMs()): void {
  const timer = setTimeout(() => {
    void fs.unlink(filePath).catch(() => undefined);
  }, delayMs);
  timer.unref();
}
