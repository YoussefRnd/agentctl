import type { AgentSkill, SkillRegistryOptions, SkillActivation } from './types.js';
import {
  readSkills,
  installBundledSkills,
  getSystemSkillsDirectory,
  getConfiguredSkillDirectories,
  getWorkspaceSkillsDirectory,
} from './skill-files.js';
export type { AgentSkill, SkillRegistryOptions, SkillActivation } from './types.js';
export {
  getAgentctlHome,
  getSystemSkillsDirectory,
  getWorkspaceSkillsDirectory,
} from './skill-files.js';
const PURPOSE_KEY = 'agentctl-purpose';

export class SkillRegistry {
  private constructor(
    private readonly skills: Map<string, AgentSkill>,
    private readonly skillsByPurpose: Map<string, AgentSkill>,
  ) {}

  static async load(options: SkillRegistryOptions): Promise<SkillRegistry> {
    // Skill installation must never prevent an ordinary ACP prompt. Callers
    // that require a particular activation can detect its absence explicitly.
    await installBundledSkills().catch(() => undefined);

    // Sources are ordered from lowest to highest precedence. Extra configured
    // sources and workspace skills can override a system skill by name or purpose.
    const directories = [
      getSystemSkillsDirectory(),
      ...getConfiguredSkillDirectories(),
      ...(options.includeWorkspaceSkills ? [getWorkspaceSkillsDirectory(options.cwd)] : []),
    ];
    const skills = new Map<string, AgentSkill>();
    const skillsByPurpose = new Map<string, AgentSkill>();
    for (const directory of directories) {
      for (const skill of await readSkills(directory)) {
        skills.set(skill.name, skill);
        const purpose = skill.metadata[PURPOSE_KEY];
        if (purpose) skillsByPurpose.set(purpose, skill);
      }
    }
    return new SkillRegistry(skills, skillsByPurpose);
  }

  get(name: string): AgentSkill | undefined {
    return this.skills.get(name);
  }

  findByPurpose(purpose: string): AgentSkill | undefined {
    return this.skillsByPurpose.get(purpose);
  }

  activate(activation?: SkillActivation): AgentSkill | undefined {
    if (activation?.name) return this.get(activation.name);
    if (activation?.purpose) return this.findByPurpose(activation.purpose);
    return undefined;
  }

  formatCatalog(): string {
    if (this.skills.size === 0) return '';
    return [
      '## Available Agent Skills',
      ...Array.from(this.skills.values())
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((skill) => `- \`${skill.name}\`: ${skill.description}`),
    ].join('\n');
  }

  formatActivation(activation?: SkillActivation): string {
    const activatedSkill = this.activate(activation);
    return activatedSkill
      ? `### Activated Skill: ${activatedSkill.name}\n\n${activatedSkill.content}`
      : '';
  }

  formatContext(activation?: SkillActivation): string {
    return [this.formatCatalog(), this.formatActivation(activation)]
      .filter(Boolean)
      .join('\n\n---\n\n');
  }
}
