import { ReviewVerificationService } from '../services/review-verification-service.js';
import { spawn } from 'node:child_process';
import { CodeReviewService } from '../services/code-review-service.js';
import type { FastifyInstance } from 'fastify';
import { AcpAgentDriver } from '@agentctl/core/acp';
import { SearchQueries } from '../services/search-queries.js';
import { SettingsService } from '../services/settings-service.js';
import { McpService } from '../services/mcp-service.js';
import { ProviderSessionQueries } from '../services/provider-session-queries.js';
import { WorkspaceQueries } from '../services/workspace-queries.js';
import { AttachmentService } from '../services/attachment-service.js';
import { SessionEventQueries } from '../services/session-event-queries.js';
import { SessionGitOperations } from '../services/session-git-operations.js';
import { SessionRepositoryService } from '../services/session-repository-service.js';
import { ProjectDirectory } from '../services/projects/project-directory.js';
import { ProjectQueries } from '../services/projects/project-queries.js';
import { ProjectService } from '../services/projects/project-service.js';

/** App-scoped lazy construction also supports isolated transport fixtures without live agents. */
function once<T>(create: () => T): () => T {
  let value: T;
  let created = false;
  return () => {
    if (!created) {
      value = create();
      created = true;
    }
    return value;
  };
}

export function createServerServices(deps: FastifyInstance) {
  let verification: ReviewVerificationService | undefined;
  const reviewVerification = () =>
    (verification ??= new ReviewVerificationService(
      deps.db,
      { open: (path) => deps.sessionManager.getRepositoryService().open(path) },
      deps.sessionManager,
      deps.eventBus,
    ));
  let reviews: CodeReviewService | undefined;
  const codeReview = () =>
    (reviews ??= new CodeReviewService(
      deps.db,
      { open: (path) => deps.sessionManager.getRepositoryService().open(path) },
      deps.providerRegistry,
      AcpAgentDriver.create(spawn, deps.log, deps.runtimeServices?.diagnostics),
      deps.eventBus,
      reviewVerification(),
    ));
  deps.addHook('preClose', async () => {
    await verification?.dispose();
    await reviews?.dispose();
  });
  const search = once(() => new SearchQueries(deps.db));
  const settings = once(() => new SettingsService(deps.providerRegistry, deps.eventBus));
  const mcp = once(() => new McpService(deps.db, deps.mcpGateway, deps.eventBus, deps.log));
  const providerSessions = once(() => new ProviderSessionQueries(deps.db, deps.providerRegistry));
  const workspaces = once(() => new WorkspaceQueries(deps.db));
  const attachments = once(() => new AttachmentService(deps.db, deps.log));
  const events = once(() => new SessionEventQueries(deps.db));
  const git = once(
    () =>
      new SessionGitOperations(
        deps.db,
        deps.worktreeManager,
        deps.sessionManager,
        deps.sessionService,
        deps.providerRegistry,
        deps.eventBus,
        new AcpAgentDriver(),
      ),
  );
  const repository = once(
    () =>
      new SessionRepositoryService(deps.db, {
        open: (path) => deps.sessionManager.getRepositoryService().open(path),
      }),
  );
  const directories = once(() => new ProjectDirectory(deps.config.AGENTCTL_WORKSPACE_SEARCH_PATHS));
  const projectQueries = once(() => new ProjectQueries(deps.db));
  const projects = once(
    () =>
      new ProjectService(
        deps.db,
        directories(),
        deps.worktreeManager,
        deps.sessionService,
        deps.eventBus,
      ),
  );
  return {
    get reviewVerification() {
      return reviewVerification();
    },
    cancelReviewChecksForSession(id: string) {
      verification?.cancelSession(id);
    },
    get codeReview() {
      return codeReview();
    },
    get search() {
      return search();
    },
    get settings() {
      return settings();
    },
    get mcp() {
      return mcp();
    },
    get providerSessions() {
      return providerSessions();
    },
    get workspaces() {
      return workspaces();
    },
    get attachments() {
      return attachments();
    },
    get events() {
      return events();
    },
    get git() {
      return git();
    },
    get repository() {
      return repository();
    },
    get directories() {
      return directories();
    },
    get projectQueries() {
      return projectQueries();
    },
    get projects() {
      return projects();
    },
  };
}

export type ServerServices = ReturnType<typeof createServerServices>;

declare module 'fastify' {
  interface FastifyInstance {
    services: ServerServices;
  }
}
