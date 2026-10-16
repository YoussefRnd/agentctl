import type { FastifyInstance } from 'fastify';
import type { RouterImplementation } from '@ts-rest/fastify';
import { projectsContract } from '@agentctl/shared';
import { launchEditorProcess, detectAvailableEditors } from '../../utils/launch-editor.js';

export function createProjectsRouter(
  fastify: FastifyInstance,
): RouterImplementation<typeof projectsContract> {
  return {
    getProjects: async ({ query }) => ({
      status: 200,
      body: await fastify.services.projectQueries.list(query),
    }),
    openProject: async ({ body }) => ({
      status: 200,
      body: await fastify.services.projects.open(body),
    }),
    getAvailableEditors: async () => {
      const available = await detectAvailableEditors();
      return {
        status: 200 as const,
        body: available,
      };
    },
    openInEditor: async ({ body }) => {
      const result = await launchEditorProcess(body.editor, body.path);
      if (!result.success) {
        return {
          status: 500 as const,
          body: {
            message: result.error ?? `Failed to launch ${body.editor}`,
          },
        };
      }
      return {
        status: 200 as const,
        body: {
          success: true,
          editor: body.editor,
        },
      };
    },
    deleteProject: async ({ params }) => {
      await fastify.services.projects.delete(params.id);
      return { status: 204, body: undefined };
    },
    exploreFs: async ({ query }) => ({
      status: 200,
      body: await fastify.services.directories.explore(query.path),
    }),
  };
}
