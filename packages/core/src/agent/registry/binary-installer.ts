import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { RegistryAgent } from '@agentctl/shared';

const execFilePromise = promisify(execFile);

async function extractArchive(archivePath: string, destDir: string): Promise<void> {
  const lowercasePath = archivePath.toLowerCase();
  if (lowercasePath.endsWith('.tar.gz') || lowercasePath.endsWith('.tgz')) {
    await execFilePromise('tar', ['-xzf', archivePath, '-C', destDir]);
  } else if (lowercasePath.endsWith('.zip')) {
    await execFilePromise('unzip', ['-o', archivePath, '-d', destDir]);
  } else {
    // If not a tar.gz or zip, try tar, fallback to unzip
    try {
      await execFilePromise('tar', ['-xzf', archivePath, '-C', destDir]);
    } catch {
      await execFilePromise('unzip', ['-o', archivePath, '-d', destDir]);
    }
  }
}

export class BinaryInstaller {
  getInstallDir(providerId: string): string {
    const home = process.env.AGENTCTL_HOME ?? path.join(os.homedir(), '.agentctl');
    return path.join(home, 'bin', providerId);
  }

  isInstalled(providerId: string): boolean {
    const dir = this.getInstallDir(providerId);
    if (!fs.existsSync(dir)) return false;
    const entries = fs.readdirSync(dir);
    return entries.length > 0;
  }

  async install(agent: RegistryAgent, platform: string): Promise<{
    command: string;
    args: string[];
    env: Record<string, string>;
  }> {
    const binaryDist = agent.distribution.binary;
    const target = binaryDist ? binaryDist[platform] : undefined;
    if (!target) {
      throw new Error(`Platform ${platform} not supported for binary agent ${agent.id}`);
    }

    const installDir = this.getInstallDir(agent.id);
    await fs.promises.mkdir(installDir, { recursive: true });

    const archiveUrl = target.archive;
    const response = await fetch(archiveUrl);
    if (!response.ok || !response.body) {
      throw new Error(`Failed to download binary archive: ${response.statusText}`);
    }

    const urlPath = new URL(archiveUrl).pathname;
    const extension = urlPath.endsWith('.tar.gz') ? '.tar.gz' : path.extname(urlPath);
    const tempFile = path.join(os.tmpdir(), `${agent.id}-${String(Date.now())}${extension || '.archive'}`);

    try {
      await pipeline(
        Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]),
        fs.createWriteStream(tempFile)
      );

      // Extract contents logic
      await extractArchive(tempFile, installDir);
    } finally {
      await fs.promises.unlink(tempFile).catch(() => { /* ignore */ });
    }

    const binaryPath = path.resolve(installDir, target.cmd);
    if (process.platform !== 'win32') {
      await fs.promises.chmod(binaryPath, 0o755).catch(() => { /* ignore */ });
    }

    return {
      command: binaryPath,
      args: target.args ?? [],
      env: target.env
    };
  }

  async remove(providerId: string): Promise<void> {
    const dir = this.getInstallDir(providerId);
    await fs.promises.rm(dir, { recursive: true, force: true }).catch(() => { /* ignore */ });
  }
}
