import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getSystemSkillsDirectory, SkillRegistry } from './registry.js';

const originalAgentctlHome = process.env.AGENTCTL_HOME;
const originalSkillsDirectory = process.env.AGENTCTL_SKILLS_DIR;
const originalSkillPath = process.env.AGENTCTL_SKILL_PATH;
const originalWorkspaceSkillsDirectory = process.env.AGENTCTL_WORKSPACE_SKILLS_DIR;

beforeEach(() => {
  delete process.env.AGENTCTL_SKILLS_DIR;
  delete process.env.AGENTCTL_SKILL_PATH;
  delete process.env.AGENTCTL_WORKSPACE_SKILLS_DIR;
});

afterEach(() => {
  const restore = (name: string, value: string | undefined) => {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  };
  restore('AGENTCTL_HOME', originalAgentctlHome);
  restore('AGENTCTL_SKILLS_DIR', originalSkillsDirectory);
  restore('AGENTCTL_SKILL_PATH', originalSkillPath);
  restore('AGENTCTL_WORKSPACE_SKILLS_DIR', originalWorkspaceSkillsDirectory);
});

describe('SkillRegistry', () => {
  it('installs bundled skills and resolves their declared purpose', async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), 'agentctl-system-skills-'));
    process.env.AGENTCTL_HOME = home;

    const registry = await SkillRegistry.load({
      cwd: home,
      includeWorkspaceSkills: false,
    });
    const installedPath = path.join(getSystemSkillsDirectory(), 'handoff', 'SKILL.md');

    expect(await fs.readFile(installedPath, 'utf8')).toContain('name: handoff');
    expect((await fs.stat(installedPath)).mode & 0o777).toBe(0o600);
    expect(registry.findByPurpose('provider-handoff')?.name).toBe('handoff');
    await fs.rm(home, { recursive: true, force: true });
  });

  it('does not overwrite an unmanaged user skill', async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), 'agentctl-system-skills-'));
    const installedPath = path.join(home, 'skills', 'handoff', 'SKILL.md');
    process.env.AGENTCTL_HOME = home;
    await fs.mkdir(path.dirname(installedPath), { recursive: true });
    const customSkill = `---
name: handoff
description: Custom handoff instructions.
---

Do the custom handoff.
`;
    await fs.writeFile(installedPath, customSkill);

    const registry = await SkillRegistry.load({
      cwd: home,
      includeWorkspaceSkills: false,
    });

    expect(await fs.readFile(installedPath, 'utf8')).toBe(customSkill);
    expect(registry.get('handoff')?.description).toBe('Custom handoff instructions.');
    await fs.rm(home, { recursive: true, force: true });
  });

  it('loads configured sources without hardcoded skill names', async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), 'agentctl-system-skills-'));
    const extra = await fs.mkdtemp(path.join(os.tmpdir(), 'agentctl-extra-skills-'));
    process.env.AGENTCTL_HOME = home;
    process.env.AGENTCTL_SKILL_PATH = extra;
    const skillDirectory = path.join(extra, 'example-skill');
    await fs.mkdir(skillDirectory);
    await fs.writeFile(
      path.join(skillDirectory, 'SKILL.md'),
      `---
name: example-skill
description: An independently configured skill.
metadata:
  agentctl-purpose: provider-handoff
---

Use the example.
`,
    );

    const registry = await SkillRegistry.load({
      cwd: home,
      includeWorkspaceSkills: false,
    });

    expect(registry.findByPurpose('provider-handoff')?.name).toBe('example-skill');
    await fs.rm(home, { recursive: true, force: true });
    await fs.rm(extra, { recursive: true, force: true });
  });
});
