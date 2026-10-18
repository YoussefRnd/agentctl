import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { expect, test } from 'vite-plus/test';

test('keeps direct ACP SDK dependencies inside the adapter', () => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const leaks = readdirSync(root, { recursive: true })
    .map(String)
    .filter((file) => file.endsWith('.ts') && !file.startsWith(`acp${path.sep}`))
    .filter((file) =>
      readFileSync(path.join(root, file), 'utf8').includes('@agentclientprotocol/sdk'),
    );
  expect(leaks).toEqual([]);
});

test('keeps the product session layer independent from the ACP adapter', () => {
  const root = fileURLToPath(new URL('../session/', import.meta.url));
  const leaks = readdirSync(root, { recursive: true })
    .map(String)
    .filter((file) => file.endsWith('.ts'))
    .filter((file) => /from ['"]\.\.\/acp\//.test(readFileSync(path.join(root, file), 'utf8')));
  expect(leaks).toEqual([]);
});

test('keeps SDK imports and custom ACP extension routing out of production app and shared code', () => {
  const workspace = fileURLToPath(new URL('../../../../', import.meta.url));
  const leaks: string[] = [];
  const scan = (directory: string) => {
    for (const name of readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, name.name);
      if (name.isDirectory()) {
        if (!['node_modules', 'dist', 'out', '.git', '.turbo'].includes(name.name)) scan(file);
        continue;
      }
      if (!/\.tsx?$/.test(name.name) || /\.(test|spec)\.tsx?$/.test(name.name)) continue;
      if (file.startsWith(path.join(workspace, 'packages/core/src/acp') + path.sep)) continue;
      if (/@agentclientprotocol\/sdk|_agentctl\.dev\//.test(readFileSync(file, 'utf8')))
        leaks.push(path.relative(workspace, file));
    }
  };
  scan(path.join(workspace, 'packages'));
  scan(path.join(workspace, 'apps'));
  expect(leaks).toEqual([]);
});
