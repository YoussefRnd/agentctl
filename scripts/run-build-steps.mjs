import { spawnSync } from 'node:child_process';

// Keep a build's final output in one cache entry; intermediate outputs can be deleted
// by later steps (for example Vite clears the TypeScript emit directory).
const steps = [[]];
for (const argument of process.argv.slice(2)) {
  if (argument === '--') steps.push([]);
  else steps.at(-1).push(argument);
}
for (const [command, ...args] of steps) {
  if (!command) throw new Error('Expected build commands separated by --');
  const child = spawnSync(command, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (child.error) throw child.error;
  if (child.status !== 0) process.exit(child.status ?? 1);
}
