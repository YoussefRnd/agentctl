import { describe, it, expect, beforeEach, afterEach } from 'vitest';
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
    await fs.mkdir(path.join(testDir, 'src'), { recursive: true });
    await fs.writeFile(path.join(testDir, 'src', 'index.ts'), 'export const hello = "world";\n');
    await fs.writeFile(path.join(testDir, 'README.md'), '# Test Repo\n');
    await git.add('.');
    await git.commit('initial commit');
  });

  afterEach(async () => {
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
});
