import { test, describe, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { Readable } from 'node:stream';
import {
  removeDirWithRetry,
  isUnsafeArchiveType,
  BinaryInstaller,
  getHome,
  resolveGitHubSha256,
} from './binary-installer.js';
import { noopLogger } from '../../logger.js';
import type { RegistryAgent } from '@agentctl/shared';

describe('removeDirWithRetry', () => {
  test('retries on EBUSY then succeeds', async () => {
    const dir = path.join(os.tmpdir(), `rmt-${String(Date.now())}`);
    fs.mkdirSync(dir);
    const rmSpy = vi
      .spyOn(fs.promises, 'rm')
      .mockRejectedValueOnce(Object.assign(new Error('EBUSY'), { code: 'EBUSY' }));
    const warn = vi.fn();
    await removeDirWithRetry(dir, { retries: 3, delays: [0, 10, 10], logger: { warn } });
    expect(fs.existsSync(dir)).toBe(false);
    expect(rmSpy.mock.calls.length).toBeGreaterThan(1);
    rmSpy.mockRestore();
  });

  test('warns and throws after exhausting retries', async () => {
    const dir = path.join(os.tmpdir(), `rmt-${String(Date.now())}`);
    fs.mkdirSync(dir);
    const rmSpy = vi
      .spyOn(fs.promises, 'rm')
      .mockRejectedValue(Object.assign(new Error('EBUSY'), { code: 'EBUSY' }));
    const warn = vi.fn();
    await expect(
      removeDirWithRetry(dir, { retries: 2, delays: [0, 10], logger: { warn } }),
    ).rejects.toThrow();
    expect(warn).toHaveBeenCalledOnce();
    rmSpy.mockRestore();
  });
});

describe('isUnsafeArchiveType', () => {
  test('allows tar.gz, tgz, zip', () => {
    expect(isUnsafeArchiveType('https://x.com/a.tar.gz')).toBe(false);
    expect(isUnsafeArchiveType('https://x.com/a.tgz')).toBe(false);
    expect(isUnsafeArchiveType('https://x.com/a.zip')).toBe(false);
  });

  test('blocks dmg/pkg/deb/rpm/msi/appimage/tar.xz/7z and unknown', () => {
    for (const ext of [
      '.dmg',
      '.pkg',
      '.deb',
      '.rpm',
      '.msi',
      '.AppImage',
      '.tar.xz',
      '.txz',
      '.7z',
      '',
    ]) {
      expect(isUnsafeArchiveType(`https://x.com/a${ext}`)).toBe(true);
    }
  });
});

describe('BinaryInstaller versioned dirs', () => {
  const installer = new BinaryInstaller();

  test('versioned dir name is stable and content-aware', () => {
    const a = installer.getVersionedInstallDir('p', '1.0.0', 'https://x.com/a.tar.gz');
    const b = installer.getVersionedInstallDir('p', '1.0.0', 'https://x.com/a.tar.gz');
    expect(a).toBe(b);
    expect(a).toContain(path.join('bin', 'p', 'v_'));
  });

  test('isInstalled true only when a populated v_ dir exists', () => {
    const base = installer.getInstallDir('p');
    fs.rmSync(base, { recursive: true, force: true });
    expect(installer.isInstalled('p')).toBe(false);
    const vdir = installer.getVersionedInstallDir('p', '1.0.0', 'https://x.com/a.tar.gz');
    fs.mkdirSync(vdir, { recursive: true });
    fs.writeFileSync(path.join(vdir, 'bin'), 'x');
    expect(installer.isInstalled('p')).toBe(true);
    fs.rmSync(base, { recursive: true, force: true });
  });

  test('removeStaleVersionedDirs deletes old versions only', async () => {
    const base = installer.getInstallDir('p');
    fs.rmSync(base, { recursive: true, force: true });
    const keep = installer.getVersionedInstallDir('p', '2.0.0', 'https://x.com/new.tar.gz');
    const old = installer.getVersionedInstallDir('p', '1.0.0', 'https://x.com/old.tar.gz');
    fs.mkdirSync(keep, { recursive: true });
    fs.mkdirSync(old, { recursive: true });
    await installer.removeStaleVersionedDirs('p', keep);
    expect(fs.existsSync(keep)).toBe(true);
    expect(fs.existsSync(old)).toBe(false);
    fs.rmSync(base, { recursive: true, force: true });
  });
});

describe('BinaryInstaller.install staging + atomic swap', () => {
  const installer = new BinaryInstaller();

  function makeTarGzFixture(dir: string, fileName: string, content: string): string {
    fs.writeFileSync(path.join(dir, fileName), content);
    const archive = path.join(dir, 'fx.tar.gz');
    execFileSync('tar', ['-czf', archive, '-C', dir, fileName]);
    return archive;
  }

  test('install extracts to staging then atomically swaps into versioned dir', async () => {
    const work = path.join(os.tmpdir(), `inst-${String(Date.now())}`);
    fs.rmSync(work, { recursive: true, force: true });
    fs.mkdirSync(work, { recursive: true });
    const content = 'binary-bytes';
    const archive = makeTarGzFixture(work, 'mybin', content);
    const sha = crypto.createHash('sha256').update(content).digest('hex');

    const agent: RegistryAgent = {
      id: 'myagent',
      name: 'myagent',
      version: '1.0.0',
      description: '',
      authors: [],
      distribution: {
        binary: {
          'linux-x86_64': {
            archive: 'https://x.com/a.tar.gz',
            cmd: 'mybin',
            args: [],
            env: {},
            sha256: sha,
          },
        },
      },
    };

    vi.stubGlobal(
      'fetch',
      vi.fn(() => ({
        ok: true,
        statusText: 'OK',
        body: Readable.toWeb(fs.createReadStream(archive)),
      })),
    );

    try {
      const result = await installer.install(agent, 'linux-x86_64');
      const base = installer.getInstallDir('myagent');
      expect(fs.existsSync(base)).toBe(true);
      const versions = fs.readdirSync(base).filter((e) => e.startsWith('v_'));
      expect(versions.length).toBe(1);
      expect(fs.existsSync(path.join(getHome(), 'staging'))).toBe(false);
      expect(fs.readFileSync(result.command, 'utf8')).toBe(content);
    } finally {
      vi.unstubAllGlobals();
      fs.rmSync(installer.getInstallDir('myagent'), { recursive: true, force: true });
    }
  });

  test('failed checksum aborts without writing final dir', async () => {
    const work = path.join(os.tmpdir(), `inst-${String(Date.now())}`);
    fs.rmSync(work, { recursive: true, force: true });
    fs.mkdirSync(work, { recursive: true });
    const archive = makeTarGzFixture(work, 'mybin', 'data');
    const agent: RegistryAgent = {
      id: 'badagent',
      name: 'badagent',
      version: '1.0.0',
      description: '',
      authors: [],
      distribution: {
        binary: {
          'linux-x86_64': {
            archive: 'https://x.com/a.tar.gz',
            cmd: 'mybin',
            args: [],
            env: {},
            sha256: 'deadbeef',
          },
        },
      },
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(() => ({
        ok: true,
        statusText: 'OK',
        body: Readable.toWeb(fs.createReadStream(archive)),
      })),
    );
    try {
      await expect(installer.install(agent, 'linux-x86_64')).rejects.toThrow(/Checksum mismatch/);
      expect(installer.isInstalled('badagent')).toBe(false);
    } finally {
      vi.unstubAllGlobals();
      fs.rmSync(installer.getInstallDir('badagent'), { recursive: true, force: true });
    }
  });
});

describe('resolveGitHubSha256', () => {
  test('parses github release url and returns decoded digest', async () => {
    const digestB64 = Buffer.from('a'.repeat(64), 'hex').toString('base64');
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        if (url.includes('api.github.com')) {
          return { ok: true, json: () => ({ assets: [{ name: 'mybin', digest: digestB64 }] }) };
        }
        return { ok: true, body: Readable.toWeb(fs.createReadStream(path.join(os.tmpdir(), 'x'))) };
      }),
    );
    const got = await resolveGitHubSha256(
      'https://github.com/o/r/releases/download/v1.0.0/mybin',
      noopLogger,
    );
    expect(got).toBe('a'.repeat(64));
    vi.unstubAllGlobals();
  });

  test('returns null for non-github or failed lookup', async () => {
    expect(await resolveGitHubSha256('https://example.com/a.tar.gz', noopLogger)).toBeNull();
    vi.stubGlobal(
      'fetch',
      vi.fn(() => ({ ok: false })),
    );
    expect(
      await resolveGitHubSha256('https://github.com/o/r/releases/download/v1/a', noopLogger),
    ).toBeNull();
    vi.unstubAllGlobals();
  });
});
