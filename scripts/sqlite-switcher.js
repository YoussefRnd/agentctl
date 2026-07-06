import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const target = process.argv[2]; // 'node' or 'electron'
if (target !== 'node' && target !== 'electron') {
  console.error("Usage: node scripts/sqlite-switcher.js [node|electron]");
  process.exit(1);
}

try {
  const packageJsonPath = require.resolve('better-sqlite3/package.json', {
    paths: [path.resolve(__dirname, '../apps/desktop')],
  });
  const betterSqlite3Dir = path.dirname(packageJsonPath);
  const releaseDir = path.join(betterSqlite3Dir, 'build', 'Release');
  const binaryPath = path.join(releaseDir, 'better_sqlite3.node');
  const nodeBackupPath = path.join(betterSqlite3Dir, 'better_sqlite3.node.node');
  const electronBackupPath = path.join(betterSqlite3Dir, 'better_sqlite3.node.electron');

  const currentTypeFile = path.join(betterSqlite3Dir, 'current_type.txt');
  let currentType = '';
  if (fs.existsSync(currentTypeFile) && fs.existsSync(binaryPath)) {
    currentType = fs.readFileSync(currentTypeFile, 'utf8').trim();
  }

  if (target === 'node') {
    if (currentType === 'node' && fs.existsSync(binaryPath)) {
      console.log('better-sqlite3 is already compiled for Node.js.');
      process.exit(0);
    }
    if (fs.existsSync(nodeBackupPath)) {
      if (!fs.existsSync(releaseDir)) {
        fs.mkdirSync(releaseDir, { recursive: true });
      }
      fs.copyFileSync(nodeBackupPath, binaryPath);
      fs.writeFileSync(currentTypeFile, 'node');
      console.log('Switched better-sqlite3 to Node.js binary (cached).');
    } else {
      console.log('Node.js backup not found, recompiling better-sqlite3 for Node.js...');
      execSync('npx node-gyp rebuild', { stdio: 'inherit', cwd: betterSqlite3Dir });
      if (fs.existsSync(binaryPath)) {
        fs.copyFileSync(binaryPath, nodeBackupPath);
        fs.writeFileSync(currentTypeFile, 'node');
      }
    }
  } else if (target === 'electron') {
    if (currentType === 'electron' && fs.existsSync(binaryPath)) {
      console.log('better-sqlite3 is already compiled for Electron.');
      process.exit(0);
    }
    if (fs.existsSync(electronBackupPath)) {
      if (!fs.existsSync(releaseDir)) {
        fs.mkdirSync(releaseDir, { recursive: true });
      }
      fs.copyFileSync(electronBackupPath, binaryPath);
      fs.writeFileSync(currentTypeFile, 'electron');
      console.log('Switched better-sqlite3 to Electron binary (cached).');
    } else {
      console.log('Electron backup not found, compiling better-sqlite3 for Electron...');
      execSync('pnpm exec electron-rebuild --module-dir apps/desktop --only better-sqlite3 --force', {
        stdio: 'inherit',
        cwd: path.join(__dirname, '..'),
      });
      if (fs.existsSync(binaryPath)) {
        fs.copyFileSync(binaryPath, electronBackupPath);
        fs.writeFileSync(currentTypeFile, 'electron');
      }
    }
  }
} catch (error) {
  console.error('Failed to switch SQLite binary:', error);
  process.exit(1);
}
