import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ContextService } from './context-service.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { simpleGit } from 'simple-git';

describe('ContextService', () => {
  let contextService: ContextService;
  let testDir: string;

  beforeEach(async () => {
    contextService = new ContextService();
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agentctl-context-test-'));

    // Initialize git repo and test files
    const git = simpleGit(testDir);
    await git.init();
    await git.addConfig('user.name', 'Test');
    await git.addConfig('user.email', 'test@example.com');
    await fs.mkdir(path.join(testDir, 'src'), { recursive: true });
    await fs.writeFile(path.join(testDir, 'src', 'index.ts'), 'export const hello = "world";\n');
    await fs.writeFile(path.join(testDir, 'README.md'), '# Test Repo\n');
    await git.add('.');
    await git.commit('initial commit');
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it('searches workspace files and git actions', async () => {
    const results = await contextService.search(testDir, '');
    expect(results.length).toBeGreaterThan(0);

    const fileItem = results.find((r) => r.type === 'file' && r.title === 'index.ts');
    expect(fileItem).toBeDefined();
    expect(fileItem?.subtitle).toBe('src/index.ts');

    const gitDiff = results.find((r) => r.id === 'git:diff');
    expect(gitDiff).toBeDefined();
  });

  it('filters results by query', async () => {
    const results = await contextService.search(testDir, 'README');
    expect(results.length).toBe(1);
    expect(results[0]?.title).toBe('README.md');
  });

  it('supports fzf-style fuzzy subsequence search', async () => {
    // Search 'ind' or 'sit' for 'src/index.ts'
    const results1 = await contextService.search(testDir, 'ind');
    expect(results1.some((r) => r.title === 'index.ts')).toBe(true);

    const results2 = await contextService.search(testDir, 'gd');
    expect(results2.some((r) => r.id === 'git:diff')).toBe(true);
  });

  it('reuses the search index and shares concurrent builds', async () => {
    const service = contextService as unknown as {
      index: { buildWorkspaceIndex: (workspace: string) => Promise<unknown> };
    };
    const build = vi.spyOn(service.index, 'buildWorkspaceIndex');
    const [files, folders] = await Promise.all([
      contextService.search(testDir, '', 'file'),
      contextService.search(testDir, '', 'folder'),
    ]);
    expect(files.every((item) => item.type === 'file')).toBe(true);
    expect(folders.map((item) => item.value)).toContain('src');
    await contextService.search(testDir, 'index');
    expect(build).toHaveBeenCalledOnce();
  });

  it('refreshes the workspace index after its TTL', async () => {
    const now = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
    await contextService.search(testDir);
    await fs.writeFile(path.join(testDir, 'new-file.ts'), 'export {};');
    expect(await contextService.search(testDir, 'new-file', 'file')).toEqual([]);
    clock.mockReturnValue(now + 5001);
    const refreshed = await contextService.search(testDir, 'new-file', 'file');
    expect(refreshed.map((item) => item.value)).toContain('new-file.ts');
  });

  it('preserves Git paths containing spaces and Unicode', async () => {
    const filename = 'résumé notes.ts';
    await fs.writeFile(path.join(testDir, filename), 'export {};');
    const results = await contextService.search(testDir, 'résumé', 'file');
    expect(results.map((item) => item.value)).toContain(filename);
    const resolved = await contextService.resolve(testDir, [{ type: 'file', value: filename }]);
    expect(resolved.items[0]?.title).toBe(filename);
  });

  it('offers files on an empty query even in deeply nested workspaces', async () => {
    const directory = Array.from({ length: 55 }, (_, index) => `dir${index}`).join('/');
    await fs.mkdir(path.join(testDir, directory), { recursive: true });
    await fs.writeFile(path.join(testDir, directory, 'deep.ts'), 'export {};');
    const results = await contextService.search(testDir);
    expect(results.length).toBe(50);
    expect(results.some((item) => item.title === 'deep.ts')).toBe(true);
  });

  it('resolves file contents into formatted markdown', async () => {
    const resolved = await contextService.resolve(testDir, [
      { type: 'file', value: 'src/index.ts' },
    ]);

    expect(resolved.items.length).toBe(1);
    expect(resolved.items[0]?.title).toBe('index.ts');
    expect(resolved.formattedContent).toContain('Context Attachment: `src/index.ts`');
    expect(resolved.formattedContent).toContain('export const hello = "world";');
  });

  it('resolves git diff output when working tree is modified', async () => {
    await fs.writeFile(path.join(testDir, 'src', 'index.ts'), 'export const hello = "agentctl";\n');

    const resolved = await contextService.resolve(testDir, [{ type: 'git', value: 'diff' }]);

    expect(resolved.items.length).toBe(1);
    expect(resolved.items[0]?.title).toBe('Git Diff');
    expect(resolved.formattedContent).toContain('### Context Attachment: Git Working Tree Diff');
    expect(resolved.formattedContent).toContain('-export const hello = "world";');
    expect(resolved.formattedContent).toContain('+export const hello = "agentctl";');
  });
  it('rejects file and folder symlinks that leave the workspace', async () => {
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'agentctl-context-outside-'));
    try {
      await fs.writeFile(path.join(outside, 'secret.txt'), 'outside secret');
      await fs.symlink(path.join(outside, 'secret.txt'), path.join(testDir, 'escape.txt'));
      await fs.symlink(outside, path.join(testDir, 'escape-dir'));
      const resolved = await contextService.resolve(testDir, [
        { type: 'file', value: 'escape.txt' },
        { type: 'folder', value: 'escape-dir' },
        { type: 'file', value: '../outside.txt' },
      ]);
      expect(resolved.items).toEqual([]);
      expect(resolved.formattedContent).toBe('');
    } finally {
      await fs.rm(outside, { recursive: true, force: true });
    }
  });

  it('bounds file attachments by bytes without splitting UTF-8 characters', async () => {
    const content = 'x' + '€'.repeat(20000);
    await fs.writeFile(path.join(testDir, 'unicode.txt'), content);
    const resolved = await contextService.resolve(testDir, [
      { type: 'file', value: 'unicode.txt' },
    ]);
    expect(resolved.items[0]?.size).toBe(Buffer.byteLength(content));
    expect(resolved.formattedContent).toContain('Truncated');
    expect(resolved.formattedContent).not.toContain('�');
    expect(Buffer.byteLength(resolved.formattedContent)).toBeLessThan(48 * 1024 + 250);
  });
});
