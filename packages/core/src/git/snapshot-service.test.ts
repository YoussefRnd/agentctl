import { test, expect, describe, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { SnapshotService } from './snapshot-service.js';

describe('SnapshotService', () => {
  let service: SnapshotService;
  let tempProjectDir: string;
  let snapshotDir: string;

  beforeEach(async () => {
    snapshotDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'snap-store-test-'));
    service = new SnapshotService(snapshotDir);
    tempProjectDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'snap-test-'));
    const { execSync } = await import('node:child_process');
    execSync('git init', { cwd: tempProjectDir });
    execSync('git config user.email "test@test.com"', { cwd: tempProjectDir });
    execSync('git config user.name "Test"', { cwd: tempProjectDir });
    execSync('git commit --allow-empty -m "init"', { cwd: tempProjectDir });
  });

  afterEach(async () => {
    await fs.promises.rm(tempProjectDir, { recursive: true, force: true }).catch(() => undefined);
    service.cleanup();
    await fs.promises.rm(snapshotDir, { recursive: true, force: true }).catch(() => undefined);
  });

  describe('track', () => {
    test('returns undefined for non-git project', async () => {
      const nonGitDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'non-git-'));
      try {
        const hash = await service.track(nonGitDir);
        expect(hash).toBeUndefined();
      } finally {
        await fs.promises.rm(nonGitDir, { recursive: true, force: true });
      }
    });

    test('returns a tree hash for a git project', async () => {
      await fs.promises.writeFile(path.join(tempProjectDir, 'hello.txt'), 'world');
      const { execSync } = await import('node:child_process');
      execSync('git add .', { cwd: tempProjectDir });
      execSync('git commit -m "add file"', { cwd: tempProjectDir });

      const hash = await service.track(tempProjectDir);
      expect(hash?.length).toBe(40);
    });

    test('returns different hashes when files change between calls', async () => {
      const hash1 = await service.track(tempProjectDir);

      await fs.promises.writeFile(path.join(tempProjectDir, 'new-file.txt'), 'content');
      const { execSync } = await import('node:child_process');
      execSync('git add .', { cwd: tempProjectDir });
      execSync('git commit -m "add new file"', { cwd: tempProjectDir });

      const hash2 = await service.track(tempProjectDir);
      expect(hash1).not.toBe(hash2);
    });

    test('serializes concurrent captures for the same project', async () => {
      await fs.promises.writeFile(path.join(tempProjectDir, 'concurrent.txt'), 'content\n');

      const hashes = await Promise.all(
        Array.from({ length: 8 }, () => service.track(tempProjectDir)),
      );

      expect(new Set(hashes).size).toBe(1);
      expect(hashes[0]).toMatch(/^[0-9a-f]{40,64}$/);
    });

    test('keeps repository subdirectory snapshots in a consistent scope', async () => {
      const subdirectory = path.join(tempProjectDir, 'apps', 'web');
      await fs.promises.mkdir(subdirectory, { recursive: true });
      await fs.promises.writeFile(path.join(tempProjectDir, 'root.txt'), 'root\n');
      await fs.promises.writeFile(path.join(subdirectory, 'file.txt'), 'before\n');
      const { execSync } = await import('node:child_process');
      execSync('git add . && git commit -m "add scoped project"', {
        cwd: tempProjectDir,
        shell: '/bin/sh',
      });

      const startHash = await service.track(subdirectory);
      await fs.promises.writeFile(path.join(subdirectory, 'file.txt'), 'after\n');
      const changes = await service.getTurnChanges(subdirectory, startHash!);

      expect(changes.files).toEqual([
        {
          path: 'file.txt',
          additions: 1,
          deletions: 1,
          status: 'modified',
        },
      ]);
    });

    test('anchors captured trees so Git pruning cannot remove historical snapshots', async () => {
      await fs.promises.writeFile(path.join(tempProjectDir, 'durable.txt'), 'before\n');
      const snapshotHash = await service.track(tempProjectDir);
      await fs.promises.writeFile(path.join(tempProjectDir, 'durable.txt'), 'after\n');
      await service.track(tempProjectDir);

      const { execSync } = await import('node:child_process');
      execSync('git reflog expire --expire=now --all && git gc --prune=now', {
        cwd: tempProjectDir,
        shell: '/bin/sh',
      });

      expect(() =>
        execSync(`git cat-file -e ${snapshotHash!}^{tree}`, { cwd: tempProjectDir }),
      ).not.toThrow();
    });
  });

  describe('diff', () => {
    test('returns patches for files changed since snapshot', async () => {
      const hash1 = await service.track(tempProjectDir);

      await fs.promises.writeFile(path.join(tempProjectDir, 'added.txt'), 'new content');
      const { execSync } = await import('node:child_process');
      execSync('git add .', { cwd: tempProjectDir });
      execSync('git commit -m "add file"', { cwd: tempProjectDir });

      const patches = await service.diff(tempProjectDir, hash1 ?? '');
      expect(patches.length).toBeGreaterThan(0);
      expect(patches[0].path).toBe('added.txt');
    });
  });

  describe('revertFiles', () => {
    test('reverts specified files to snapshot state', async () => {
      await fs.promises.writeFile(path.join(tempProjectDir, 'file.txt'), 'original');
      const { execSync } = await import('node:child_process');
      execSync('git add .', { cwd: tempProjectDir });
      execSync('git commit -m "add file"', { cwd: tempProjectDir });

      const hash = await service.track(tempProjectDir);

      await fs.promises.writeFile(path.join(tempProjectDir, 'file.txt'), 'modified');

      const patches = [{ path: 'file.txt', status: 'modified' as const }];
      await service.revertFiles(tempProjectDir, hash ?? '', patches);

      const content = await fs.promises.readFile(path.join(tempProjectDir, 'file.txt'), 'utf-8');
      expect(content).toBe('original');
    });

    test('creates a usable undo snapshot for modified, deleted, and untracked files', async () => {
      await fs.promises.writeFile(path.join(tempProjectDir, 'modified.txt'), 'before\n');
      await fs.promises.writeFile(path.join(tempProjectDir, 'deleted.txt'), 'keep me\n');
      const { execSync } = await import('node:child_process');
      execSync('git add . && git commit -m "restore baseline"', {
        cwd: tempProjectDir,
        shell: '/bin/sh',
      });
      const baseline = await service.track(tempProjectDir);

      await fs.promises.writeFile(path.join(tempProjectDir, 'modified.txt'), 'after\n');
      await fs.promises.rm(path.join(tempProjectDir, 'deleted.txt'));
      await fs.promises.writeFile(path.join(tempProjectDir, 'untracked.txt'), 'new\n');

      const restore = await service.restoreFiles(tempProjectDir, baseline!);
      expect(await fs.promises.readFile(path.join(tempProjectDir, 'modified.txt'), 'utf8')).toBe(
        'before\n',
      );
      expect(await fs.promises.readFile(path.join(tempProjectDir, 'deleted.txt'), 'utf8')).toBe(
        'keep me\n',
      );
      await expect(
        fs.promises.access(path.join(tempProjectDir, 'untracked.txt')),
      ).rejects.toThrow();

      await service.restoreFiles(tempProjectDir, restore.backupHash);
      expect(await fs.promises.readFile(path.join(tempProjectDir, 'modified.txt'), 'utf8')).toBe(
        'after\n',
      );
      await expect(fs.promises.access(path.join(tempProjectDir, 'deleted.txt'))).rejects.toThrow();
      expect(await fs.promises.readFile(path.join(tempProjectDir, 'untracked.txt'), 'utf8')).toBe(
        'new\n',
      );
    });
  });

  describe('getTurnChanges', () => {
    test('computes exact additions, deletions, and statuses between snapshots', async () => {
      await fs.promises.writeFile(path.join(tempProjectDir, 'existing.txt'), 'line1\nline2\n');
      const { execSync } = await import('node:child_process');
      execSync('git add .', { cwd: tempProjectDir });
      execSync('git commit -m "add existing file"', { cwd: tempProjectDir });

      const startHash = await service.track(tempProjectDir);
      expect(startHash).toBeDefined();

      // Modify existing file and create a new file
      await fs.promises.writeFile(
        path.join(tempProjectDir, 'existing.txt'),
        'line1\nline2_modified\nline3\n',
      );
      await fs.promises.writeFile(path.join(tempProjectDir, 'new.txt'), 'created\n');

      const endHash = await service.track(tempProjectDir);
      expect(endHash).toBeDefined();

      const turnChanges = await service.getTurnChanges(tempProjectDir, startHash!, endHash!);
      expect(turnChanges.files.length).toBe(2);

      const existingChange = turnChanges.files.find((f) => f.path === 'existing.txt');
      expect(existingChange).toBeDefined();
      expect(existingChange?.status).toBe('modified');
      expect(existingChange?.additions).toBe(2);
      expect(existingChange?.deletions).toBe(1);

      const newChange = turnChanges.files.find((f) => f.path === 'new.txt');
      expect(newChange).toBeDefined();
      expect(newChange?.status).toBe('added');
      expect(newChange?.additions).toBe(1);
      expect(newChange?.deletions).toBe(0);

      expect(turnChanges.totalAdditions).toBe(3);
      expect(turnChanges.totalDeletions).toBe(1);
    });

    test('parses filenames containing tabs without corrupting paths or statistics', async () => {
      const startHash = await service.track(tempProjectDir);
      const unusualPath = 'tab\tname.txt';
      await fs.promises.writeFile(path.join(tempProjectDir, unusualPath), 'content\n');

      const turnChanges = await service.getTurnChanges(tempProjectDir, startHash!);

      expect(turnChanges.files).toEqual([
        {
          path: unusualPath,
          additions: 1,
          deletions: 0,
          status: 'added',
        },
      ]);
    });

    test('rejects invalid snapshot hashes instead of treating failures as empty changes', async () => {
      await expect(
        service.getTurnChanges(tempProjectDir, '0000000000000000000000000000000000000000'),
      ).rejects.toThrow();
    });
  });

  describe('getReviewFiles', () => {
    test('renders the complete snapshot diff for committed and uncommitted changes', async () => {
      await fs.promises.writeFile(path.join(tempProjectDir, 'review.txt'), 'base\n');
      const { execSync } = await import('node:child_process');
      execSync('git add . && git commit -m "review baseline"', {
        cwd: tempProjectDir,
        shell: '/bin/sh',
      });
      const baseline = await service.track(tempProjectDir);

      await fs.promises.writeFile(path.join(tempProjectDir, 'review.txt'), 'base\ncommitted\n');
      execSync('git add . && git commit -m "committed during session"', {
        cwd: tempProjectDir,
        shell: '/bin/sh',
      });
      await fs.promises.appendFile(path.join(tempProjectDir, 'review.txt'), 'uncommitted\n');

      const reviewFiles = await service.getReviewFiles(tempProjectDir, baseline!);

      expect(reviewFiles).toHaveLength(1);
      expect(reviewFiles[0].state).toBe('modified');
      expect(reviewFiles[0].diff).toContain('+committed');
      expect(reviewFiles[0].diff).toContain('+uncommitted');
    });

    test('compares and restores a repository commit within a project subdirectory', async () => {
      const subdirectory = path.join(tempProjectDir, 'packages', 'app');
      await fs.promises.mkdir(subdirectory, { recursive: true });
      await fs.promises.writeFile(path.join(tempProjectDir, 'outside.txt'), 'outside\n');
      await fs.promises.writeFile(path.join(subdirectory, 'inside.txt'), 'before\n');
      const { execSync } = await import('node:child_process');
      execSync('git add . && git commit -m "subdirectory baseline"', {
        cwd: tempProjectDir,
        shell: '/bin/sh',
      });
      const baselineCommit = execSync('git rev-parse HEAD', {
        cwd: tempProjectDir,
        encoding: 'utf8',
      }).trim();

      await fs.promises.writeFile(path.join(subdirectory, 'inside.txt'), 'after\n');
      const reviewFiles = await service.getReviewFiles(subdirectory, baselineCommit);

      expect(reviewFiles).toHaveLength(1);
      expect(reviewFiles[0].path).toBe('inside.txt');
      expect(reviewFiles[0].diff).toContain('-before');
      expect(reviewFiles[0].diff).toContain('+after');

      await service.restoreFiles(subdirectory, baselineCommit);
      expect(await fs.promises.readFile(path.join(subdirectory, 'inside.txt'), 'utf8')).toBe(
        'before\n',
      );
      expect(await fs.promises.readFile(path.join(tempProjectDir, 'outside.txt'), 'utf8')).toBe(
        'outside\n',
      );
    });
  });
});
