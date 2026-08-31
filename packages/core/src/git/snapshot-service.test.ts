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
  });
});
