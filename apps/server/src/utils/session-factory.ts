import { sessions, projects, type DriverRegistry } from '@agentctl/core';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { ThinkingEffort } from '@agentctl/shared';
import { AppError } from './app-error.js';

interface CreateAgentSessionInput {
  projectId: string;
  agent: string;
  taskSlug: string;
}

async function resolveInitialSelection(driverRegistry: DriverRegistry, driverId: string) {
  const drivers = await driverRegistry.discover();
  const driver = drivers.find((d) => d.id === driverId);
  const options = driver?.configOptions ?? [];

  const modelOpt = options.find((o) => o.id === 'model' || o.id === 'selectedModel');
  const thinkingOpt = options.find(
    (o) => o.id === 'thinking' || o.id === 'thinking_effort' || o.id === 'selectedThinkingEffort',
  );

  return {
    selectedDriver: driverId,
    selectedModel: modelOpt?.currentValue ?? modelOpt?.options[0]?.value ?? 'default',
    selectedThinkingEffort: (thinkingOpt?.currentValue ??
      thinkingOpt?.options[0]?.value ??
      'medium') as ThinkingEffort,
  };
}

function buildLaunchArgs(
  driver: NonNullable<Awaited<ReturnType<DriverRegistry['getDriver']>>>,
  model: string,
  thinkingEffort: string,
): { command: string; args: string[]; env: Record<string, string> } {
  const baseArgs = driver.launchArgs;
  const baseEnv = driver.launchEnv;
  const extraArgs: string[] = [];

  if (model && model !== 'default') extraArgs.push('--model', model);
  if (thinkingEffort) extraArgs.push('--thinking-effort', thinkingEffort);

  return {
    command: driver.command,
    args: [...baseArgs, ...extraArgs],
    env: baseEnv,
  };
}

export async function createAgentSession(fastify: FastifyInstance, input: CreateAgentSessionInput) {
  const { projectId, agent, taskSlug } = input;

  const project = await fastify.db.query.projects.findFirst({
    where: eq(projects.id, projectId),
  });

  if (!project) {
    throw new AppError('Project not found', 404);
  }

  if (!project.repoRoot) {
    throw new AppError('This project is not inside a Git repository. Sessions require Git.', 400);
  }

  const driver = await fastify.driverRegistry.getDriver(agent);
  if (driver?.status !== 'ready') {
    throw new AppError(`Selected agent is not ready: ${agent}`, 400);
  }

  const sessionId = crypto.randomUUID();

  // Create the worktree at the repo root, preserving the subdirectory offset
  const worktree = await fastify.worktreeManager.create(
    project.repoRoot,
    sessionId,
    taskSlug,
    'main',
    project.subdir,
  );

  const selection = await resolveInitialSelection(fastify.driverRegistry, agent);

  const [createdSession] = await fastify.db
    .insert(sessions)
    .values({
      id: sessionId,
      projectId,
      branch: worktree.branch,
      // Store the worktree root path; workspacePath is derived from subdir at runtime
      worktreePath: worktree.path,
      agent,
      status: 'idle',
      taskSlug,
      baseCommit: worktree.baseCommit,
      ...selection,
    })
    .returning();

  const launch = buildLaunchArgs(
    driver,
    createdSession.selectedModel,
    createdSession.selectedThinkingEffort,
  );

  try {
    // Launch the agent from workspacePath (worktreePath/subdir) so it starts
    // in the correct subdirectory for backend/frontend monorepo projects.
    fastify.sessionManager.startSession(
      sessionId,
      worktree.workspacePath,
      launch.command,
      launch.args,
      launch.env,
    );
  } catch (err) {
    fastify.log.error(err, 'Failed to start session');
  }

  return createdSession;
}

