import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { expect, it } from 'vite-plus/test';

it('keeps the repository domain independent of concrete backends and session orchestration', () => {
  const directory = fileURLToPath(new URL('./', import.meta.url));
  const violations: string[] = [];
  for (const entry of readdirSync(directory, { recursive: true })) {
    const file = String(entry);
    if (!file.endsWith('.ts') || file.endsWith('.test.ts')) continue;
    const source = readFileSync(path.join(directory, file), 'utf8');
    for (const match of source.matchAll(/(?:from\s*|import\s*\()(['"])([^'"]+)\1/g)) {
      const specifier = match[2];
      if (
        /(?:^|\/)(?:git|acp|session|providers)\//.test(specifier) ||
        /default-repository-service|simple-git|node:child_process/.test(specifier)
      )
        violations.push(`${file}: ${specifier}`);
    }
  }
  expect(violations).toEqual([]);
});
