import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { expect, test } from 'vitest';

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
