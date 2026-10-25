import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { getHome } from './binary-installer.js';

const execFileAsync = promisify(execFile);

export function npxPackageSpec(command: string, args: string[]): string | undefined {
  if (!/(?:^|[/\\])npx(?:\.cmd)?$/i.test(command)) return undefined;
  const spec = args[0] === '-y' || args[0] === '--yes' ? args[1] : args[0];
  return spec &&
    /^(?:@[a-zA-Z0-9][a-zA-Z0-9._-]*\/)?[a-zA-Z0-9][a-zA-Z0-9._-]*(?:@[a-zA-Z0-9._+~-]+)?$/.test(
      spec,
    )
    ? spec
    : undefined;
}

/** Check npm's completed tree, not just a package directory left by interrupted extraction. */
export async function isNpxPackagePrepared(cache: string, spec: string): Promise<boolean> {
  if (npxPackageSpec('npx', [spec]) !== spec) return false;
  const lastAt = spec.lastIndexOf('@');
  const name = lastAt > 0 ? spec.slice(0, lastAt) : spec;
  try {
    for (const entry of await fs.readdir(path.join(cache, '_npx'), { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const directory = path.join(cache, '_npx', entry.name);
      try {
        const manifest = JSON.parse(
          await fs.readFile(path.join(directory, 'package.json'), 'utf8'),
        );
        if (!Array.isArray(manifest._npx?.packages) || !manifest._npx.packages.includes(spec))
          continue;
        JSON.parse(await fs.readFile(path.join(directory, 'package-lock.json'), 'utf8'));
        const packageDirectory = path.join(directory, 'node_modules', name);
        const pkg = JSON.parse(
          await fs.readFile(path.join(packageDirectory, 'package.json'), 'utf8'),
        );
        if (pkg.name !== name) continue;
        const version = lastAt > 0 ? spec.slice(lastAt + 1).replace(/^v/, '') : '';
        if (/^\d+\.\d+\.\d+(?:[-+].*)?$/.test(version) && pkg.version !== version) continue;
        const bins: Record<string, string> =
          typeof pkg.bin === 'string' ? { [name.split('/').at(-1)!]: pkg.bin } : pkg.bin;
        if (!bins || Object.keys(bins).length === 0) continue;
        let ready = true;
        for (const [bin, relative] of Object.entries(bins)) {
          if (typeof relative !== 'string' || bin !== path.basename(bin)) {
            ready = false;
            break;
          }
          const target = path.resolve(packageDirectory, relative);
          if (
            !target.startsWith(`${path.resolve(packageDirectory)}${path.sep}`) ||
            !(await fs.stat(target)).isFile()
          ) {
            ready = false;
            break;
          }
          const shim = path.join(
            directory,
            'node_modules',
            '.bin',
            bin + (process.platform === 'win32' ? '.cmd' : ''),
          );
          await fs.access(
            shim,
            process.platform === 'win32' ? fs.constants.F_OK : fs.constants.X_OK,
          );
        }
        if (ready) return true;
      } catch {
        /* Missing manifests, lockfiles or executables mean preparation did not finish. */
      }
    }
  } catch {
    /* Missing cache is handled the same way as an incomplete one. */
  }
  return false;
}

export async function createNpxCache(providerId: string, spec: string): Promise<string> {
  const key = crypto
    .createHash('sha256')
    .update(`${providerId}\0${spec}`)
    .digest('hex')
    .slice(0, 20);
  const root = path.join(getHome(), 'provider-npx-cache');
  await fs.mkdir(root, { recursive: true });
  return fs.mkdtemp(path.join(root, `${key}-`));
}

/** Downloads have their own deadline and finish before the ACP request deadline starts. */
export async function prepareNpxPackage(
  spec: string,
  cache: string,
  environment: Record<string, string>,
  signal?: AbortSignal,
): Promise<void> {
  if (npxPackageSpec('npx', [spec]) !== spec) throw new Error('Unsafe npx package spec');
  await execFileAsync(
    process.platform === 'win32' ? 'npm.cmd' : 'npm',
    ['exec', '--yes', `--package=${spec}`, '--', 'node', '--version'],
    {
      cwd: os.tmpdir(),
      env: { ...process.env, ...environment, npm_config_cache: cache },
      signal,
      timeout: 10 * 60_000,
      maxBuffer: 1024 * 1024,
      shell: process.platform === 'win32',
    },
  );
  signal?.throwIfAborted();
  if (!(await isNpxPackagePrepared(cache, spec)))
    throw new Error('npm did not finish preparing the provider package');
}
