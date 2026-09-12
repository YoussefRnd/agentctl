import fs from 'node:fs/promises';

const source = new URL('../src/skills/builtin/', import.meta.url);
const destination = new URL('../dist/skills/builtin/', import.meta.url);

await fs.mkdir(destination, { recursive: true });
await fs.cp(source, destination, { recursive: true, force: true });
