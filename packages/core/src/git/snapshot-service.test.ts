import { test, expect, describe, beforeEach, afterEach, vi } from 'vite-plus/test';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  SnapshotService,
  SnapshotRestoreError,
  type SnapshotComparison,
} from './snapshot-service.js';

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();

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

  describe('restoreFiles', () => {
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
    test.each(['hash', 'tree ref'])(
      'allows another capture while calculating statistics from a resolved %s',
      async (source) => {
        const baseline = await service.track(tempProjectDir);
        const from = source === 'hash' ? baseline! : 'refs/agentctl/test-tree';
        if (source === 'tree ref') git(tempProjectDir, 'update-ref', from, baseline!);
        await fs.promises.writeFile(path.join(tempProjectDir, 'file.txt'), 'captured\n');
        const paused = Promise.withResolvers<void>();
        const resume = Promise.withResolvers<void>();
        const { comparison: internals } = service as unknown as {
          comparison: { compareTrees(...args: unknown[]): Promise<SnapshotComparison> };
        };
        const compareTrees = internals.compareTrees.bind(internals);
        const spy = vi.spyOn(internals, 'compareTrees').mockImplementationOnce(async (...args) => {
          paused.resolve();
          await resume.promise;
          return compareTrees(...args);
        });
        const comparison = service.getTurnChanges(tempProjectDir, from);
        let capture: Promise<string | undefined> | undefined;
        try {
          await paused.promise;
          await fs.promises.writeFile(path.join(tempProjectDir, 'file.txt'), 'later\nextra\n');
          let captureFinished = false;
          capture = service.track(tempProjectDir).then((hash) => {
            captureFinished = true;
            return hash;
          });
          await vi.waitFor(() => expect(captureFinished).toBe(true));
          if (source === 'tree ref') git(tempProjectDir, 'update-ref', from, (await capture)!);
          resume.resolve();
          expect(await comparison).toMatchObject({
            totalAdditions: 1,
            totalDeletions: 0,
            files: [{ path: 'file.txt', status: 'added' }],
          });
          expect(
            (await service.getTurnChanges(tempProjectDir, baseline!, await capture)).totalAdditions,
          ).toBe(2);
        } finally {
          resume.resolve();
          await Promise.allSettled([comparison, capture]);
          spy.mockRestore();
        }
      },
    );

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
    test('allows capture during patch formatting and retains the captured status and content', async () => {
      await fs.promises.writeFile(path.join(tempProjectDir, 'file.txt'), 'baseline\n');
      git(tempProjectDir, 'add', '.');
      git(tempProjectDir, 'commit', '-m', 'baseline');
      const baseline = await service.track(tempProjectDir);
      await fs.promises.writeFile(path.join(tempProjectDir, 'file.txt'), 'captured\n');
      git(tempProjectDir, 'add', '.');
      const paused = Promise.withResolvers<void>();
      const resume = Promise.withResolvers<void>();
      const { comparison: internals } = service as unknown as {
        comparison: { fillDiffs(...args: unknown[]): Promise<void> };
      };
      const fillDiffs = internals.fillDiffs.bind(internals);
      const spy = vi.spyOn(internals, 'fillDiffs').mockImplementationOnce(async (...args) => {
        paused.resolve();
        await resume.promise;
        return fillDiffs(...args);
      });
      const review = service.getReview(tempProjectDir, baseline!, { scope: 'working' });
      let capture: Promise<string | undefined> | undefined;
      try {
        await paused.promise;
        await fs.promises.writeFile(path.join(tempProjectDir, 'file.txt'), 'later\nextra\n');
        git(tempProjectDir, 'add', '.');
        git(tempProjectDir, 'commit', '-m', 'later edit');
        let captureFinished = false;
        capture = service.track(tempProjectDir).then((hash) => {
          captureFinished = true;
          return hash;
        });
        await vi.waitFor(() => expect(captureFinished).toBe(true));
        resume.resolve();
        const { files, capture: reviewCapture } = await review;
        expect(files).toHaveLength(1);
        expect(files[0]).toMatchObject({
          path: 'file.txt',
          state: 'staged',
          hasStagedChanges: true,
          hasUnstagedChanges: false,
          additions: 1,
          deletions: 1,
        });
        expect(files[0].diff).toContain('+captured');
        expect(files[0].diff).not.toContain('later');
        expect(reviewCapture!.currentTree).not.toBe(await capture);
        expect(git(tempProjectDir, 'status', '--porcelain')).toBe('');
      } finally {
        resume.resolve();
        await Promise.allSettled([review, capture]);
        spy.mockRestore();
      }
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

  describe('deleteProjectSnapshots', () => {
    test('deletes project anchor ref and snapshot directory on disk', async () => {
      await fs.promises.writeFile(path.join(tempProjectDir, 'sample.txt'), 'data\n');
      const hash = await service.track(tempProjectDir);
      expect(hash).toBeDefined();

      const { execSync } = await import('node:child_process');
      const projectHash = crypto
        .createHash('sha256')
        .update(await fs.promises.realpath(tempProjectDir))
        .digest('hex')
        .substring(0, 16);
      const anchorRef = `refs/agentctl/snapshots/${projectHash}`;

      expect(() =>
        execSync(`git rev-parse --verify ${anchorRef}`, { cwd: tempProjectDir }),
      ).not.toThrow();

      await service.deleteProjectSnapshots(tempProjectDir);

      expect(() =>
        execSync(`git rev-parse --verify ${anchorRef}`, { cwd: tempProjectDir }),
      ).toThrow();
      await expect(fs.promises.access(path.join(snapshotDir, projectHash))).rejects.toThrow();
    });
  });
  describe('snapshot regressions', () => {
    test('preserves tracked ignored files and respects ancestor ignores in subprojects', async () => {
      const project = path.join(tempProjectDir, 'pkg');
      await fs.promises.mkdir(project);
      await fs.promises.writeFile(path.join(tempProjectDir, '.gitignore'), 'pkg/*.txt\n');
      await fs.promises.writeFile(path.join(project, 'tracked.txt'), 'tracked\n');
      git(tempProjectDir, 'add', '.gitignore');
      git(tempProjectDir, 'add', '-f', 'pkg/tracked.txt');
      git(tempProjectDir, 'commit', '-m', 'ignored tracked baseline');
      const baseline = git(tempProjectDir, 'rev-parse', 'HEAD');
      await fs.promises.writeFile(path.join(project, 'ignored.txt'), 'ignored\n');
      await fs.promises.writeFile(path.join(project, 'staged.txt'), 'force staged\n');
      git(tempProjectDir, 'add', '-f', 'pkg/staged.txt');
      const userIndex = await fs.promises.readFile(path.join(tempProjectDir, '.git', 'index'));
      const capture = await service.track(project);
      expect(git(tempProjectDir, 'ls-tree', '--name-only', capture!)).toBe(
        'staged.txt\ntracked.txt',
      );
      const files = await service.getReviewFiles(project, baseline, { scope: 'working' });
      expect(files.map((file) => file.path)).toEqual(['staged.txt']);
      expect(files[0].diff).toContain('+force staged');
      expect(await fs.promises.readFile(path.join(tempProjectDir, '.git', 'index'))).toEqual(
        userIndex,
      );
    });

    test('captures a subproject when the user index has an unrelated merge conflict', async () => {
      const project = path.join(tempProjectDir, 'pkg');
      await fs.promises.mkdir(project);
      await fs.promises.writeFile(path.join(project, 'file.txt'), 'project\n');
      git(tempProjectDir, 'add', '.');
      git(tempProjectDir, 'commit', '-m', 'baseline');
      const blob = git(tempProjectDir, 'rev-parse', 'HEAD:pkg/file.txt');
      execFileSync('git', ['update-index', '--index-info'], {
        cwd: tempProjectDir,
        input: `100644 ${blob} 1\toutside.txt\n100644 ${blob} 2\toutside.txt\n`,
      });
      const index = await fs.promises.readFile(path.join(tempProjectDir, '.git', 'index'));
      const capture = await service.track(project);
      expect(git(tempProjectDir, 'show', `${capture}:file.txt`)).toBe('project');
      expect(await fs.promises.readFile(path.join(tempProjectDir, '.git', 'index'))).toEqual(index);
    });

    test('does not treat a root tracked filename as tracked inside a subproject', async () => {
      const project = path.join(tempProjectDir, 'app');
      await fs.promises.mkdir(project);
      await fs.promises.writeFile(path.join(tempProjectDir, 'secret.txt'), 'root tracked\n');
      await fs.promises.writeFile(path.join(project, '.gitignore'), 'secret.txt\n');
      git(tempProjectDir, 'add', '.');
      git(tempProjectDir, 'commit', '-m', 'name collision baseline');
      await fs.promises.writeFile(path.join(project, 'secret.txt'), 'ignored value\n');
      const capture = await service.track(project);
      expect(git(tempProjectDir, 'ls-tree', '--name-only', capture!)).toBe('.gitignore');
    });

    test('validates all restore paths before deleting any files or nested repositories', async () => {
      const baseline = await service.track(tempProjectDir);
      await fs.promises.writeFile(path.join(tempProjectDir, 'a.txt'), 'keep me\n');
      const nested = path.join(tempProjectDir, 'vendor');
      await fs.promises.mkdir(nested);
      git(nested, 'init');
      git(nested, 'config', 'user.name', 'Test');
      git(nested, 'config', 'user.email', 'test@example.com');
      await fs.promises.writeFile(path.join(nested, 'inside.txt'), 'nested content\n');
      git(nested, 'add', '.');
      git(nested, '-c', 'commit.gpgSign=false', 'commit', '-m', 'nested baseline');
      await expect(service.restoreFiles(tempProjectDir, baseline!)).rejects.toThrow(
        'Cannot restore nested repository vendor',
      );
      expect(await fs.promises.readFile(path.join(tempProjectDir, 'a.txt'), 'utf8')).toBe(
        'keep me\n',
      );
      expect(await fs.promises.readFile(path.join(nested, 'inside.txt'), 'utf8')).toBe(
        'nested content\n',
      );
      expect(git(nested, 'rev-parse', '--is-inside-work-tree')).toBe('true');
    });

    test('rejects directory-to-file restores without removing ignored directory contents', async () => {
      await fs.promises.writeFile(path.join(tempProjectDir, 'item'), 'baseline\n');
      const baseline = await service.track(tempProjectDir);
      await fs.promises.rm(path.join(tempProjectDir, 'item'));
      await fs.promises.mkdir(path.join(tempProjectDir, 'item'));
      await fs.promises.writeFile(path.join(tempProjectDir, '.gitignore'), 'item/\n');
      await fs.promises.writeFile(path.join(tempProjectDir, 'item', 'ignored.txt'), 'keep\n');
      await expect(service.restoreFiles(tempProjectDir, baseline!)).rejects.toThrow(
        'a directory occupies the file path',
      );
      expect(
        await fs.promises.readFile(path.join(tempProjectDir, 'item', 'ignored.txt'), 'utf8'),
      ).toBe('keep\n');
    });

    test('reports rollback failures and keeps a usable recovery tree', async () => {
      await fs.promises.writeFile(
        path.join(tempProjectDir, '.gitattributes'),
        'broken.txt filter=fail\n',
      );
      git(tempProjectDir, 'config', 'filter.fail.clean', 'cat');
      git(tempProjectDir, 'config', 'filter.fail.smudge', 'false');
      git(tempProjectDir, 'config', 'filter.fail.required', 'true');
      await fs.promises.writeFile(path.join(tempProjectDir, 'broken.txt'), 'before\n');
      const baseline = await service.track(tempProjectDir);
      await fs.promises.writeFile(path.join(tempProjectDir, 'broken.txt'), 'after\n');
      let failure: unknown;
      try {
        await service.restoreFiles(tempProjectDir, baseline!);
      } catch (error) {
        failure = error;
      }
      expect(failure).toBeInstanceOf(SnapshotRestoreError);
      const restoreError = failure as SnapshotRestoreError;
      expect(restoreError.rollbackError).toBeDefined();
      expect(restoreError.message).toContain('Rollback also failed');
      expect(restoreError.message).toContain(restoreError.backupHash);
      expect(git(tempProjectDir, 'show', `${restoreError.backupHash}:broken.txt`)).toBe('after');
    });

    test('keeps session and working statistics consistent with their own patches', async () => {
      await fs.promises.writeFile(path.join(tempProjectDir, 'file.txt'), 'base\n');
      git(tempProjectDir, 'add', '.');
      git(tempProjectDir, 'commit', '-m', 'baseline');
      const baseline = await service.track(tempProjectDir);
      await fs.promises.appendFile(path.join(tempProjectDir, 'file.txt'), 'committed\n');
      git(tempProjectDir, 'add', '.');
      git(tempProjectDir, 'commit', '-m', 'committed change');
      await fs.promises.appendFile(path.join(tempProjectDir, 'file.txt'), 'uncommitted\n');
      const [session] = await service.getReviewFiles(tempProjectDir, baseline!, {
        scope: 'session',
      });
      const [working] = await service.getReviewFiles(tempProjectDir, baseline!, {
        scope: 'working',
      });
      expect(session.additions).toBe(2);
      expect(session.diff).toContain('+committed');
      expect(session.diff).toContain('+uncommitted');
      expect(working.additions).toBe(1);
      expect(working.sessionAdditions).toBe(2);
      expect(working.diff).not.toContain('+committed');
      expect(working.diff).toContain('+uncommitted');
    });

    test('treats checkpoint filenames literally, including Git pathspec magic', async () => {
      const baseline = await service.track(tempProjectDir);
      const filename = ':(glob)*.txt';
      await fs.promises.writeFile(path.join(tempProjectDir, filename), 'literal\n');
      await fs.promises.writeFile(path.join(tempProjectDir, 'other.txt'), 'unrelated\n');
      const current = await service.track(tempProjectDir);
      const files = await service.getCheckpointDiffFiles(
        tempProjectDir,
        baseline!,
        current!,
        filename,
      );
      expect(files).toHaveLength(1);
      expect(files[0].path).toBe(filename);
      expect(files[0].additions).toBe(1);
      expect(files[0].diff).toContain('+literal');
      expect(files[0].diff).not.toContain('other.txt');
    });

    test('applies configurable blob and output limits to every diff scope', async () => {
      const limited = new SnapshotService(snapshotDir, { maxDiffBytes: 128 });
      await fs.promises.writeFile(path.join(tempProjectDir, 'tracked.txt'), 'before\n');
      git(tempProjectDir, 'add', '.');
      git(tempProjectDir, 'commit', '-m', 'baseline');
      const baseline = await limited.track(tempProjectDir);
      await fs.promises.writeFile(path.join(tempProjectDir, 'tracked.txt'), 'A'.repeat(256));
      await fs.promises.writeFile(path.join(tempProjectDir, 'untracked.txt'), 'B'.repeat(256));
      await fs.promises.writeFile(path.join(tempProjectDir, 'small.txt'), 'small content\n');
      const review = await limited.getReview(tempProjectDir, baseline!, { scope: 'working' });
      for (const file of review.files) expect(file.diff).toContain('Diff omitted');
      const checkpoint = await limited.getCheckpointDiffFiles(
        tempProjectDir,
        baseline!,
        review.capture!.currentTree,
      );
      for (const file of checkpoint) expect(file.diff).toContain('Diff omitted');
      expect(review.files.find((file) => file.path === 'tracked.txt')?.additions).toBe(1);
    });

    test('reads file details from an immutable capture without refreshing the index', async () => {
      const baseline = await service.track(tempProjectDir);
      await fs.promises.writeFile(path.join(tempProjectDir, 'file.txt'), 'captured\n');
      const review = await service.getReview(tempProjectDir, baseline!, {
        includeDiffs: false,
        scope: 'working',
      });
      const { currentTree, workingTree } = review.capture!;
      const index = path.join(
        snapshotDir,
        crypto
          .createHash('sha256')
          .update(await fs.promises.realpath(tempProjectDir))
          .digest('hex')
          .substring(0, 16),
        'index',
      );
      await fs.promises.rm(index);
      await fs.promises.writeFile(path.join(tempProjectDir, 'file.txt'), 'changed since summary\n');
      const [detail] = await service.getCheckpointDiffFiles(
        tempProjectDir,
        workingTree,
        currentTree,
        'file.txt',
      );
      expect(detail.diff).toContain('+captured');
      expect(detail.diff).not.toContain('changed since summary');
      expect(fs.existsSync(index)).toBe(false);
      const [unchanged] = await service.getCheckpointDiffFiles(
        tempProjectDir,
        currentTree,
        currentTree,
        'file.txt',
      );
      expect(unchanged.diff).toBe('');
      expect(unchanged.additions).toBe(0);
    });
  });
});
