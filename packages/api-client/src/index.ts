import { initQueryClient } from '@ts-rest/react-query';
import { apiContract } from '@agentctl/shared';
import { apiClient } from './api-client.js';

export * from './api-client.js';
export * from './api-error.js';
export * from './query-client.js';
export * from './services/project-sessions.js';
export * from './services/attachments.js';

export const api = initQueryClient(apiContract, {
  baseUrl: '',
  baseHeaders: {},
  api: async ({ path, method, headers, body }) => {
    const responseBody = await apiClient.fetch(path, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    return {
      status: 200,
      body: responseBody,
      headers: new Headers(),
    };
  },
});
