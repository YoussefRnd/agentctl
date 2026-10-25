import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { getHome } from './binary-installer.js';
import type { ProviderLaunchConfig as LaunchResolved } from '../provider.js';

const execFileAsync = promisify(execFile);
const normalize = (name: string) => name.toLowerCase().replace(/[_.-]+/g, '-');

export function uvxPackageSpec(
  command: string,
  args: string[],
  env: Record<string, string>,
): string | undefined {
  const spec = /(?:^|[/\\])uvx(?:\.exe)?$/i.test(command) ? args[0] : env.AGENTCTL_UVX_PACKAGE;
  if (!spec) return undefined;
  // Registries sometimes use npm-style version notation for Python tools.
  const normalized = spec.replace(
    /^([a-zA-Z0-9][a-zA-Z0-9._-]*(?:\[[a-zA-Z0-9,._-]+\])?)@([^/\s]+)$/,
    '$1==$2',
  );
  return /^[a-zA-Z0-9][a-zA-Z0-9._-]*(?:\[[a-zA-Z0-9,._-]+\])?(?:(?:==|~=|>=|<=|!=|>|<)[a-zA-Z0-9.+!_*,<>=~ -]+|\s*@\s*https:\/\/\S+)?$/.test(
    normalized,
  )
    ? normalized
    : undefined;
}

export function uvxEnvironment(root: string, spec: string): Record<string, string> {
  return {
    UV_TOOL_DIR: path.join(root, 'tools'),
    UV_TOOL_BIN_DIR: path.join(root, 'bin'),
    UV_CACHE_DIR: path.join(root, 'cache'),
    AGENTCTL_UVX_ROOT: root,
    AGENTCTL_UVX_PACKAGE: spec,
  };
}

export async function createUvxCache(providerId: string, spec: string): Promise<string> {
  const key = crypto
    .createHash('sha256')
    .update(`${providerId}\0${spec}`)
    .digest('hex')
    .slice(0, 20);
  const root = path.join(getHome(), 'provider-uvx-cache');
  await fs.mkdir(root, { recursive: true });
  return fs.mkdtemp(path.join(root, `${key}-`));
}

export async function preparedUvxCommand(
  root: string | undefined,
  spec: string,
): Promise<string | undefined> {
  if (
    !root ||
    !path.resolve(root).startsWith(`${path.resolve(getHome(), 'provider-uvx-cache')}${path.sep}`)
  )
    return undefined;
  try {
    const receipt = JSON.parse(await fs.readFile(path.join(root, 'ready.json'), 'utf8'));
    if (
      receipt.spec !== spec ||
      typeof receipt.executable !== 'string' ||
      typeof receipt.tool !== 'string'
    )
      return undefined;
    const command = path.resolve(root, receipt.executable);
    const tool = path.resolve(root, receipt.tool);
    if (
      !command.startsWith(`${path.resolve(root, 'bin')}${path.sep}`) ||
      !tool.startsWith(`${path.resolve(root, 'tools')}${path.sep}`)
    )
      return undefined;
    await fs.access(path.join(tool, 'uv-receipt.toml'));
    await fs.access(path.join(tool, 'pyvenv.cfg'));
    await fs.access(
      path.join(tool, process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python'),
    );
    const stat = await fs.stat(command);
    if (!stat.isFile() || stat.size !== receipt.size || stat.mtimeMs !== receipt.mtimeMs)
      return undefined;
    await fs.access(command, process.platform === 'win32' ? fs.constants.F_OK : fs.constants.X_OK);
    return command;
  } catch {
    return undefined;
  }
}

export async function prepareUvxPackage(
  spec: string,
  root: string,
  environment: Record<string, string>,
  signal?: AbortSignal,
): Promise<string> {
  if (uvxPackageSpec('uvx', [spec], {}) !== spec)
    throw new Error('Unsupported uvx package specification');
  await execFileAsync(
    process.platform === 'win32' ? 'uv.exe' : 'uv',
    ['tool', 'install', '--', spec],
    {
      cwd: os.tmpdir(),
      env: { ...process.env, ...environment, ...uvxEnvironment(root, spec) },
      signal,
      timeout: 10 * 60_000,
      maxBuffer: 1024 * 1024,
      windowsHide: true,
    },
  );
  signal?.throwIfAborted();
  const entries = (await fs.readdir(path.join(root, 'bin'), { withFileTypes: true }))
    .filter((e) => e.isFile() || e.isSymbolicLink())
    .map((e) => e.name);
  const name = normalize(/^[a-zA-Z0-9][a-zA-Z0-9._-]*/.exec(spec)![0]);
  const executable =
    entries.find((e) => normalize(e.replace(/\.exe$/i, '')) === name) ??
    (entries.length === 1 ? entries[0] : undefined);
  if (!executable)
    throw new Error('The Python package does not expose an unambiguous tool executable');
  const tools = (await fs.readdir(path.join(root, 'tools'), { withFileTypes: true })).filter((e) =>
    e.isDirectory(),
  );
  const tool = tools.find((e) => normalize(e.name) === name);
  if (!tool) throw new Error('uv did not create the requested tool environment');
  const command = path.join(root, 'bin', executable);
  const stat = await fs.stat(command);
  await fs.writeFile(
    path.join(root, 'ready.json'),
    JSON.stringify({
      spec,
      executable: `bin/${executable}`,
      tool: `tools/${tool.name}`,
      size: stat.size,
      mtimeMs: stat.mtimeMs,
    }),
    { mode: 0o600 },
  );
  if (!(await preparedUvxCommand(root, spec)))
    throw new Error('uv did not finish preparing the provider tool');
  return command;
}

export function uvxArguments(launch: LaunchResolved): string[] {
  return /(?:^|[/\\])uvx(?:\.exe)?$/i.test(launch.command) ? launch.args.slice(1) : launch.args;
}
