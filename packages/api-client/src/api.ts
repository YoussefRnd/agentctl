import { initClient } from '@ts-rest/core';
import { apiContract } from '@agentctl/shared';
import { apiClient } from './api-client.js';

export { setApiBaseUrl } from './api-client.js';

export const api = initClient(apiContract, {
  baseUrl: '',
  baseHeaders: {},
  api: async ({ path, method, headers, body }) => {
    const res = await apiClient.fetchWithStatus(path, {
      method,
      headers,
      body: body ?? undefined,
    });
    return {
      status: res.status,
      body: res.body,
      headers: res.headers,
    };
  },
});
