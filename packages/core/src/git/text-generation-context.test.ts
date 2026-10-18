import { afterEach, beforeEach, expect, it } from 'vite-plus/test';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildGitTextContext } from './text-generation-context.js';
let cwd: string;
const git = (...args: string[]) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
beforeEach(async () => {
  cwd = await mkdtemp(path.join(os.tmpdir(), 'agentctl-text-context-'));
  git('init', '-b', 'main');
  git('config', 'user.name', 'Test');
  git('config', 'user.email', 'test@example.com');
  git('config', 'commit.gpgSign', 'false');
  await writeFile(path.join(cwd, 'base.txt'), 'baseline\n');
  await writeFile(path.join(cwd, '.gitignore'), '*.local\n');
  git('add', '.');
  git('commit', '-m', 'feat: initial');
  git('checkout', '-b', 'feature');
});
afterEach(async () => {
  await rm(cwd, { recursive: true, force: true });
});

it('uses exactly staged files and does not mutate index, refs, or working files', async () => {
  await writeFile(path.join(cwd, 'staged.txt'), 'staged content');
  git('add', 'staged.txt');
  await writeFile(path.join(cwd, 'base.txt'), 'unstaged content');
  await writeFile(path.join(cwd, 'untracked.txt'), 'untracked content');
  await writeFile(path.join(cwd, 'private.local'), 'ignored content');
  const index = git('write-tree');
  const head = git('rev-parse', 'HEAD');
  const status = git('status', '--porcelain');
  const staged = await buildGitTextContext(cwd, { kind: 'commit' });
  expect(staged.prompt).toContain('staged content');
  expect(staged.prompt).not.toContain('unstaged content');
  expect(staged.prompt).not.toContain('untracked content');
  const all = await buildGitTextContext(cwd, { kind: 'commit', includeUnstaged: true });
  expect(all.prompt).toContain('unstaged content');
  expect(all.prompt).toContain('untracked content');
  expect(all.prompt).not.toContain('ignored content');
  expect(git('write-tree')).toBe(index);
  expect(git('rev-parse', 'HEAD')).toBe(head);
  expect(git('status', '--porcelain')).toBe(status);
});
it('merge drafts describe accumulated commits and pending files against any local destination', async () => {
  git('branch', 'release');
  await writeFile(path.join(cwd, 'feature.txt'), 'first feature');
  git('add', '.');
  git('commit', '-m', 'feat: first feature');
  await writeFile(path.join(cwd, 'pending.txt'), 'pending feature');
  const draft = await buildGitTextContext(cwd, { kind: 'merge', targetBranch: 'release' });
  expect(draft.prompt).toContain('first feature');
  expect(draft.prompt).toContain('pending feature');
  expect(draft.prompt).toContain('destination: release');
});
it('PR context excludes dirty files and later base-only commits, follows committed templates', async () => {
  await writeFile(path.join(cwd, 'feature.txt'), 'feature change');
  git('add', '.');
  git('commit', '-m', 'feat: feature change');
  git('checkout', 'main');
  await writeFile(path.join(cwd, 'base-only.txt'), 'only base branch');
  git('add', '.');
  git('commit', '-m', 'BASE_ONLY_MESSAGE');
  git('checkout', 'feature');
  await writeFile(path.join(cwd, 'pending.txt'), 'DO_NOT_INCLUDE_PENDING');
  await writeFile(path.join(cwd, 'base.txt'), 'DO_NOT_INCLUDE_DIRTY');
  const draft = await buildGitTextContext(cwd, { kind: 'pr', targetBranch: 'main' });
  expect(draft.prompt).toContain('feature change');
  expect(draft.prompt).not.toContain('BASE_ONLY_MESSAGE');
  expect(draft.prompt).not.toContain('only base branch');
  expect(draft.prompt).not.toContain('DO_NOT_INCLUDE');
});
it('PR context uses the tracked remote base and its template', async () => {
  const { mkdir } = await import('node:fs/promises');
  await mkdir(path.join(cwd, '.github'));
  await writeFile(
    path.join(cwd, '.github/pull_request_template.md'),
    '## Changes\n## Verification',
  );
  git('add', '.');
  git('commit', '-m', 'feat: template');
  git('remote', 'add', 'origin', 'https://example.invalid/repo.git');
  git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  await writeFile(path.join(cwd, 'new.txt'), 'remote comparison change');
  git('add', '.');
  git('commit', '-m', 'feat: new');
  const draft = await buildGitTextContext(cwd, { kind: 'pr', targetBranch: 'main' });
  expect(draft.prompt).toContain('PR template:\n## Changes\n## Verification');
  expect(draft.prompt).toContain('remote comparison change');
  expect(draft.prompt.split('Commits in scope:')[1]!.split('Diff stat:')[0]).not.toContain(
    'feat: template',
  );
});
it('fingerprint changes when only the destination advances', async () => {
  await writeFile(path.join(cwd, 'feature.txt'), 'feature');
  git('add', '.');
  git('commit', '-m', 'feat: feature');
  const initial = await buildGitTextContext(cwd, { kind: 'merge', targetBranch: 'main' });
  git('checkout', 'main');
  await writeFile(path.join(cwd, 'new-base.txt'), 'base');
  git('add', '.');
  git('commit', '-m', 'feat: advance main');
  git('checkout', 'feature');
  expect(
    (await buildGitTextContext(cwd, { kind: 'merge', targetBranch: 'main' })).fingerprint,
  ).not.toBe(initial.fingerprint);
});
it('bounds large context, marks truncation, and refuses empty or invalid scopes', async () => {
  await expect(buildGitTextContext(cwd, { kind: 'commit' })).rejects.toThrow('no changes');
  await expect(
    buildGitTextContext(cwd, { kind: 'merge', targetBranch: '--help' }),
  ).rejects.toThrow();
  await writeFile(path.join(cwd, 'base.txt'), 'x'.repeat(60_000));
  const draft = await buildGitTextContext(cwd, { kind: 'commit', includeUnstaged: true });
  expect(draft.prompt).toContain('[Context truncated]');
  expect(draft.prompt.length).toBeLessThan(50_000);
});

it('does not stale a staged-only draft when unrelated unstaged files change', async () => {
  await writeFile(path.join(cwd, 'staged.txt'), 'staged content');
  git('add', 'staged.txt');
  const initial = await buildGitTextContext(cwd, { kind: 'commit', includeUnstaged: false });
  await writeFile(path.join(cwd, 'base.txt'), 'unrelated dirty change');
  await writeFile(path.join(cwd, 'new.txt'), 'unrelated untracked change');
  expect(
    (await buildGitTextContext(cwd, { kind: 'commit', includeUnstaged: false })).fingerprint,
  ).toBe(initial.fingerprint);
});

it('supports an initial commit without HEAD and keeps the unborn branch and index intact', async () => {
  git('checkout', '--orphan', 'initial');
  git('rm', '-rf', '.');
  await writeFile(path.join(cwd, 'new.txt'), 'initial content');
  const all = await buildGitTextContext(cwd, { kind: 'commit', includeUnstaged: true });
  expect(all.prompt).toContain('initial content');
  git('add', 'new.txt');
  const index = git('write-tree');
  await writeFile(path.join(cwd, 'new.txt'), 'updated initial content');
  expect(
    (await buildGitTextContext(cwd, { kind: 'commit', includeUnstaged: true })).prompt,
  ).toContain('updated initial content');
  expect(
    (await buildGitTextContext(cwd, { kind: 'commit', includeUnstaged: false })).prompt,
  ).toContain('initial content');
  expect(git('write-tree')).toBe(index);
  expect(git('branch', '--show-current')).toBe('initial');
});

it('limits commit drafts to the selected project folder without exposing unrelated changes', async () => {
  const project = path.join(cwd, 'app');
  await mkdir(project);
  await writeFile(path.join(project, 'file.txt'), 'project baseline');
  git('add', '.');
  git('commit', '-m', 'Add project');
  await writeFile(path.join(project, 'file.txt'), 'project staged change');
  await writeFile(path.join(cwd, 'base.txt'), 'UNRELATED_STAGED_CONTENT');
  git('add', '.');
  await writeFile(path.join(cwd, 'base.txt'), 'UNRELATED_WORKING_CONTENT');
  const before = git('write-tree');
  for (const includeUnstaged of [false, true]) {
    const context = await buildGitTextContext(project, { kind: 'commit', includeUnstaged });
    expect(context.prompt).toContain('project staged change');
    expect(context.prompt).not.toContain('UNRELATED_');
  }
  expect(git('write-tree')).toBe(before);
});
