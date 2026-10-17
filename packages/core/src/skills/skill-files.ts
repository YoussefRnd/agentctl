import fs from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDocument } from 'yaml';

import type { AgentSkill } from './types.js';

const SKILL_FILE_NAME = 'SKILL.md';
const MANAGED_BY_KEY = 'managed-by';
const MANAGED_BY_AGENTCTL = 'agentctl';
const SKILL_NAME_PATTERN = /^(?!-)(?!.*--)[a-z0-9-]{1,64}(?<!-)$/;
const installations = new Map<string, Promise<void>>();

// Only in-flight work is retained here; successful directory receipts are bounded.
const completed = new Set<string>();

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

export function getConfiguredSkillDirectories(): string[] {
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

export async function readSkills(directory: string): Promise<AgentSkill[]> {
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

export async function installBundledSkills(): Promise<void> {
  const systemDirectory = getSystemSkillsDirectory();
  if (completed.has(systemDirectory)) return;
  const activeInstallation = installations.get(systemDirectory);
  if (activeInstallation) return activeInstallation;

  const installation = copyBundledSkills(systemDirectory);
  installations.set(systemDirectory, installation);
  try {
    await installation;
    completed.delete(systemDirectory);
    if (completed.size >= 20) completed.delete(completed.keys().next().value!);
    completed.add(systemDirectory);
  } finally {
    if (installations.get(systemDirectory) === installation) installations.delete(systemDirectory);
  }
}
