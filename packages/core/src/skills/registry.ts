import fs from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDocument } from 'yaml';

const SKILL_FILE_NAME = 'SKILL.md';
const MANAGED_BY_KEY = 'managed-by';
const MANAGED_BY_AGENTCTL = 'agentctl';
const PURPOSE_KEY = 'agentctl-purpose';
const SKILL_NAME_PATTERN = /^(?!-)(?!.*--)[a-z0-9-]{1,64}(?<!-)$/;
const installations = new Map<string, Promise<void>>();

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

export function getAgentctlHome(): string {
  return process.env.AGENTCTL_HOME ?? path.join(os.homedir(), '.agentctl');
}

export function getSystemSkillsDirectory(): string {
  return process.env.AGENTCTL_SKILLS_DIR ?? path.join(getAgentctlHome(), 'skills');
}

export function getWorkspaceSkillsDirectory(cwd: string): string {
  const configuredPath =
    process.env.AGENTCTL_WORKSPACE_SKILLS_DIR ?? path.join('.agents', 'skills');
  return path.resolve(cwd, configuredPath);
}

function getBundledSkillsDirectory(): string {
  return fileURLToPath(new URL('./builtin/', import.meta.url));
}

function getConfiguredSkillDirectories(): string[] {
  return (process.env.AGENTCTL_SKILL_PATH ?? '')
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => path.resolve(entry));
}

function parseSkill(content: string, directory: string): AgentSkill | null {
  const frontmatterMatch = /^---\s*\n([\s\S]*?)\n---(?:\s*\n|$)/.exec(content);
  if (!frontmatterMatch?.[1]) return null;

  const document = parseDocument(frontmatterMatch[1]);
  if (document.errors.length > 0) return null;

  const frontmatter = document.toJS() as unknown;
  if (!frontmatter || typeof frontmatter !== 'object' || Array.isArray(frontmatter)) return null;

  const values = frontmatter as Record<string, unknown>;
  const name = values.name;
  const description = values.description;
  const compatibility = values.compatibility;
  if (
    typeof name !== 'string' ||
    !SKILL_NAME_PATTERN.test(name) ||
    name !== path.basename(directory) ||
    typeof description !== 'string' ||
    description.trim().length === 0 ||
    description.length > 1024 ||
    (values.license !== undefined && typeof values.license !== 'string') ||
    (compatibility !== undefined &&
      (typeof compatibility !== 'string' ||
        compatibility.length === 0 ||
        compatibility.length > 500)) ||
    (values['allowed-tools'] !== undefined && typeof values['allowed-tools'] !== 'string')
  ) {
    return null;
  }

  const metadata: Record<string, string> = {};
  if (values.metadata !== undefined) {
    if (!values.metadata || typeof values.metadata !== 'object' || Array.isArray(values.metadata)) {
      return null;
    }
    for (const [key, value] of Object.entries(values.metadata as Record<string, unknown>)) {
      if (typeof value !== 'string') return null;
      metadata[key] = value;
    }
  }

  return { name, description, content, directory, metadata };
}

async function readSkills(directory: string): Promise<AgentSkill[]> {
  let entries: Dirent[];
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch {
    return [];
  }

  const skills = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => {
        const skillDirectory = path.join(directory, entry.name);
        try {
          const content = await fs.readFile(path.join(skillDirectory, SKILL_FILE_NAME), 'utf8');
          return parseSkill(content, skillDirectory);
        } catch {
          return null;
        }
      }),
  );
  return skills.filter((skill): skill is AgentSkill => skill !== null);
}

async function copyBundledSkills(systemDirectory: string): Promise<void> {
  const bundledSkills = await readSkills(getBundledSkillsDirectory());
  await fs.mkdir(systemDirectory, { recursive: true, mode: 0o700 });

  for (const bundledSkill of bundledSkills) {
    const targetDirectory = path.join(systemDirectory, bundledSkill.name);
    const targetFile = path.join(targetDirectory, SKILL_FILE_NAME);
    let installedSkill: AgentSkill | null = null;
    let targetExists = false;
    try {
      const installedContent = await fs.readFile(targetFile, 'utf8');
      targetExists = true;
      installedSkill = parseSkill(installedContent, targetDirectory);
    } catch {
      // The bundled skill has not been installed.
    }

    if (
      targetExists &&
      (!installedSkill || installedSkill.metadata[MANAGED_BY_KEY] !== MANAGED_BY_AGENTCTL)
    ) {
      continue;
    }

    await fs.mkdir(targetDirectory, { recursive: true, mode: 0o700 });
    await fs.cp(bundledSkill.directory, targetDirectory, {
      recursive: true,
      force: true,
      preserveTimestamps: true,
    });
    await fs.chmod(targetDirectory, 0o700);
    await fs.chmod(targetFile, 0o600);
  }
}

async function installBundledSkills(): Promise<void> {
  const systemDirectory = getSystemSkillsDirectory();
  const activeInstallation = installations.get(systemDirectory);
  if (activeInstallation) return activeInstallation;

  const installation = copyBundledSkills(systemDirectory).catch((error: unknown) => {
    installations.delete(systemDirectory);
    throw error;
  });
  installations.set(systemDirectory, installation);
  return installation;
}

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

  formatContext(activation?: SkillActivation): string {
    if (this.skills.size === 0) return '';

    const catalog = [
      '## Available Agent Skills',
      ...Array.from(this.skills.values(), (skill) => `- \`${skill.name}\`: ${skill.description}`),
    ].join('\n');
    const activatedSkill = this.activate(activation);
    if (!activatedSkill) return catalog;

    return `${catalog}\n\n---\n\n### Activated Skill: ${activatedSkill.name}\n\n${activatedSkill.content}`;
  }
}
