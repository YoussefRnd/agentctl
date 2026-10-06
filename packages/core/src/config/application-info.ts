import { createRequire } from 'node:module';

const { version } = createRequire(import.meta.url)('../../package.json') as { version: string };

/** Keep protocol identity aligned with the installed core package. */
export function applicationInfo(name = 'agentctl') {
  return { name, title: 'Agentctl', version };
}
