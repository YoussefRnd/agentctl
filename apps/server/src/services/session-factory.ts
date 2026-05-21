import { sessions, projects } from '@agentctl/core';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { DriverDiscovery } from '@agentctl/shared';
import { buildLaunchConfig, resolveDriverSelection } from './driver-selection.js';
import { AppError } from '../errors/app-error.js';

interface CreateAgentSessionInput {
	projectId: string;
	agent: string;
	taskSlug: string;
}

function resolveInitialSelection(driverId: string, driver: DriverDiscovery | null) {
	if (!driver) {
		return {
			selectedDriver: driverId,
			selectedModel: 'default',
			selectedThinkingEffort: 'medium',
		};
	}

	const { selectedModel, selectedThinkingEffort } = resolveDriverSelection(driver);

	return {
		selectedDriver: driverId,
		selectedModel,
		selectedThinkingEffort,
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

	const driver = await fastify.driverRegistry.ensureDriverReady(agent, { force: false });
	if (driver.status !== 'ready' && driver.status !== 'needs_auth') {
		throw new AppError(`Selected agent is not ready: ${agent}`, 400);
	}

	const sessionId = crypto.randomUUID();

	let branch = 'main';
	let worktreePath = project.path;
	let workspacePath = project.path;
	let baseCommit = 'none';

	if (project.repoRoot) {
		// Create the worktree at the repo root, preserving the subdirectory offset
		const worktree = await fastify.worktreeManager.create(
			project.repoRoot,
			sessionId,
			taskSlug,
			'main',
			project.subdir,
		);
		branch = worktree.branch;
		worktreePath = worktree.path;
		workspacePath = worktree.workspacePath;
		baseCommit = worktree.baseCommit;
	}

	const selection = resolveInitialSelection(agent, driver);

	const [createdSession] = await fastify.db
		.insert(sessions)
		.values({
			id: sessionId,
			projectId,
			branch,
			// Store the worktree root path; workspacePath is derived from subdir at runtime
			worktreePath,
			agent,
			status: 'idle',
			taskSlug,
			baseCommit,
			...selection,
		})
		.returning();

	const launch = buildLaunchConfig(
		driver,
		createdSession.selectedModel,
		createdSession.selectedThinkingEffort,
	);

	try {
		// Launch the agent from workspacePath (worktreePath/subdir) so it starts
		// in the correct subdirectory for backend/frontend monorepo projects.
		fastify.sessionManager.startSession(
			sessionId,
			workspacePath,
			launch.command,
			launch.args,
			launch.env,
		);
	} catch (err) {
		fastify.log.error(err, 'Failed to start session');
	}

	return createdSession;
}
