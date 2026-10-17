export interface AgentSkill {
  name: string;
  description: string;
  content: string;
  directory: string;
  metadata: Record<string, string>;
}

export interface SkillRegistryOptions {
  cwd: string;
  includeWorkspaceSkills: boolean;
}

export interface SkillActivation {
  name?: string;
  purpose?: string;
}
