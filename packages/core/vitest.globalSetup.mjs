import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../');

export async function setup() {
  try {
    execSync('node scripts/sqlite-switcher.js node', { cwd: root, stdio: 'inherit' });
  } catch (e) {
    console.warn('Failed to switch better-sqlite3 to Node binary:', e?.message ?? e);
  }
}
