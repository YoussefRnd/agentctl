import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  Provider,
  type ProviderData,
  type ProviderLaunchConfig as LaunchResolved,
} from '../provider.js';
import type { ProviderStore } from './provider-store.js';
import { BinaryInstaller, getPlatformKey } from './binary-installer.js';
import type { Logger } from '../../logger.js';
import { OperationDiagnostics, redactDiagnosticText } from '../../agent/operation-diagnostics.js';
import { jsonCodecs } from '../../db/json-codecs.js';
import { getNpmCache, preserveProviderFailure } from './provider-diagnostics.js';
import {
  createNpxCache,
  isNpxPackagePrepared,
  npxPackageSpec,
  prepareNpxPackage,
} from './npx-cache.js';
import {
  createUvxCache,
  preparedUvxCommand,
  prepareUvxPackage,
  uvxArguments,
  uvxEnvironment,
  uvxPackageSpec,
} from './uvx-cache.js';
import { ProviderLifecycleError } from './provider-lifecycle-error.js';

/** Only installation metadata can be persisted; resolved credentials remain process-local. */
export function preparationEnvironment(env: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    [
      'npm_config_cache',
      'UV_TOOL_DIR',
      'UV_TOOL_BIN_DIR',
      'UV_CACHE_DIR',
      'AGENTCTL_UVX_ROOT',
      'AGENTCTL_UVX_PACKAGE',
    ]
      .filter((key) => env[key] !== undefined)
      .map((key) => [key, env[key]]),
  );
}

export async function isExecutable(command: string, env: Record<string, string>): Promise<boolean> {
  const isPath = path.isAbsolute(command) || /[/\\]/.test(command);
  const directories = isPath ? [''] : (env.PATH ?? process.env.PATH ?? '').split(path.delimiter);
  const extensions =
    process.platform === 'win32' && !path.extname(command)
      ? ['', ...(env.PATHEXT ?? process.env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM').split(';')]
      : [''];
  for (const directory of directories)
    for (const extension of extensions) {
      const file = isPath
        ? path.resolve(os.tmpdir(), command + extension)
        : path.resolve(os.tmpdir(), directory, command + extension);
      try {
        if ((await fs.stat(file)).isFile()) {
          await fs.access(
            file,
            process.platform === 'win32' ? fs.constants.F_OK : fs.constants.X_OK,
          );
          return true;
        }
      } catch {
        /* Try the next executable location. */
      }
    }
  return false;
}

/** One launch gate for every ACP installation source. It never retries protocol/auth failures. */
export class ProviderPreparation {
  private readonly pending = new Map<string, Promise<LaunchResolved>>();
  private readonly shutdown = new AbortController();
  constructor(
    private store: ProviderStore,
    private installer: BinaryInstaller,
    private logger: Logger,
  ) {}

  async prepare(
    providerId: string,
    launch: LaunchResolved,
    signal?: AbortSignal,
    candidateRow?: ProviderData,
    publish = true,
  ): Promise<LaunchResolved> {
    const trace = new OperationDiagnostics('launch-preparation', this.logger, { providerId });
    trace.stage('validating-installation');
    try {
      const result = await this.prepareInstallation(
        providerId,
        launch,
        signal,
        candidateRow,
        publish,
      );
      this.shutdown.signal.throwIfAborted();
      signal?.throwIfAborted();
      trace.finish('success');
      return result;
    } catch (error) {
      const row = candidateRow ?? this.store.get(providerId);
      await preserveProviderFailure({
        trace,
        providerId,
        version: row?.installedVersion,
        installSource: row?.installSource,
        error,
        environment: launch.env,
        logger: this.logger,
      });
      throw error;
    }
  }

  private async prepareInstallation(
    providerId: string,
    launch: LaunchResolved,
    signal: AbortSignal | undefined,
    candidateRow: ProviderData | undefined,
    publish: boolean,
  ): Promise<LaunchResolved> {
    this.shutdown.signal.throwIfAborted();
    signal?.throwIfAborted();
    const row = candidateRow ?? this.store.get(providerId);
    if (!row) throw new Error(`Provider ${providerId} not found`);
    const owner = row.registryAgentId ?? providerId;
    const npm = npxPackageSpec(launch.command, launch.args);
    const uvx = uvxPackageSpec(launch.command, launch.args, launch.env);
    const managed =
      row.installSource === 'managed' || !!this.installer.managedVersionDir(owner, launch.command);
    const source = npm ? 'npx' : uvx ? 'uvx' : managed ? 'managed' : 'system';
    if (/(?:^|[/\\])(?:npx(?:\.cmd)?|uvx(?:\.exe)?)$/i.test(launch.command) && !npm && !uvx)
      throw new ProviderLifecycleError(
        'PREPARATION_FAILED',
        'The package runner requires a supported package specification',
        { retryable: false },
      );
    if (npm && (await isNpxPackagePrepared(getNpmCache(launch.env), npm))) return launch;
    if (uvx) {
      const command = await preparedUvxCommand(launch.env.AGENTCTL_UVX_ROOT, uvx);
      if (command) return { command, args: uvxArguments(launch), env: launch.env };
    }
    if (managed && (await this.installer.isPreparedCommand(owner, launch.command, signal)))
      return launch;
    if (source === 'system') {
      if (!(await isExecutable(launch.command, launch.env)))
        throw new ProviderLifecycleError(
          'EXECUTABLE_NOT_FOUND',
          `The configured provider executable ${redactDiagnosticText(launch.command, launch.env)} is missing or cannot be executed. Restore its installation or select an installed executable in provider settings.`,
          { retryable: false },
        );
      return launch;
    }
    this.shutdown.signal.throwIfAborted();
    signal?.throwIfAborted();
    const key = JSON.stringify([
      owner,
      source,
      launch.command,
      launch.args,
      preparationEnvironment(launch.env),
      publish,
    ]);
    let operation = this.pending.get(key);
    if (!operation) {
      operation = this.repair(owner, row, launch, source, npm ?? uvx, signal, publish);
      this.pending.set(key, operation);
      const active = operation;
      void active
        .finally(() => {
          if (this.pending.get(key) === active) this.pending.delete(key);
        })
        .catch(() => {});
    }
    const result = await operation;
    signal?.throwIfAborted();
    this.shutdown.signal.throwIfAborted();
    // Profile credentials can differ even when the installation is shared.
    return { ...result, env: { ...launch.env, ...preparationEnvironment(result.env) } };
  }

  private async repair(
    owner: string,
    row: ProviderData,
    launch: LaunchResolved,
    source: string,
    spec: string | undefined,
    signal: AbortSignal | undefined,
    publish: boolean,
  ): Promise<LaunchResolved> {
    const trace = new OperationDiagnostics('package-preparation', this.logger, {
      providerId: owner,
      installSource: source,
    });
    trace.stage(source === 'managed' ? 'artifact-preparation' : 'package-preparation');
    const abort = AbortSignal.any([
      this.shutdown.signal,
      AbortSignal.timeout(10 * 60_000),
      ...(signal ? [signal] : []),
    ]);
    let cache: string | undefined;
    try {
      let prepared: LaunchResolved;
      if (source === 'npx') {
        cache = await createNpxCache(owner, spec!);
        await prepareNpxPackage(spec!, cache, launch.env, abort);
        prepared = { ...launch, env: { ...launch.env, npm_config_cache: cache } };
      } else if (source === 'uvx') {
        cache = await createUvxCache(owner, spec!);
        const command = await prepareUvxPackage(spec!, cache, launch.env, abort);
        prepared = {
          command,
          args: uvxArguments(launch),
          env: { ...launch.env, ...uvxEnvironment(cache, spec!) },
        };
      } else {
        let receipt;
        try {
          receipt = await this.installer.readReceipt(owner, launch.command);
        } catch {
          /* Use matching catalog metadata below. */
        }
        const agent = new Provider(row).toDiscovery().agent;
        const version = receipt?.version ?? row.installedVersion ?? agent?.version;
        const target =
          receipt?.target ??
          (agent && agent.version === version
            ? agent.distribution.binary?.[getPlatformKey()]
            : undefined);
        if (!agent || !version || !target)
          throw new ProviderLifecycleError(
            'PREPARATION_FAILED',
            'The installed provider release is damaged and its original download metadata is unavailable. Use Update or Install to select a release.',
            { retryable: false },
          );
        const repaired = await this.installer.install(
          {
            ...agent,
            id: owner,
            version,
            distribution: { binary: { [getPlatformKey()]: target } },
          },
          getPlatformKey(),
          this.logger,
          { signal: abort, onStage: (stage) => trace.stage(stage) },
        );
        prepared = { ...launch, command: repaired.command };
      }
      abort.throwIfAborted();
      const current = this.store.get(owner);
      const originalArgs = jsonCodecs.stringArray(current?.launchArgs);
      const sameArgs = JSON.stringify(originalArgs) === JSON.stringify(launch.args);
      const legacyArgs =
        !originalArgs.length &&
        !!current?.installedVersion &&
        !!spec &&
        (spec.endsWith(`@${current.installedVersion}`) ||
          spec.endsWith(`==${current.installedVersion}`));
      if (
        publish &&
        current?.command === launch.command &&
        (sameArgs || legacyArgs) &&
        JSON.stringify(preparationEnvironment(jsonCodecs.stringRecord(current.launchEnv))) ===
          JSON.stringify(preparationEnvironment(jsonCodecs.stringRecord(row.launchEnv)))
      ) {
        this.store.update(owner, {
          command: prepared.command,
          launchArgs: JSON.stringify(prepared.args),
          launchEnv: JSON.stringify({
            ...jsonCodecs.stringRecord(current.launchEnv),
            ...preparationEnvironment(prepared.env),
          }),
        });
      }
      trace.finish('success');
      return prepared;
    } catch (error) {
      await preserveProviderFailure({
        trace,
        providerId: owner,
        version: row.installedVersion,
        installSource: source,
        error,
        npmCache: source === 'npx' ? cache : undefined,
        environment: launch.env,
        logger: this.logger,
      });
      if (cache) await fs.rm(cache, { recursive: true, force: true }).catch(() => {});
      throw error;
    }
  }

  async dispose(): Promise<void> {
    this.shutdown.abort(new Error('Provider preparation is shutting down'));
    await Promise.allSettled(this.pending.values());
  }
}
