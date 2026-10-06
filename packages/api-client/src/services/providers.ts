import { apiClient } from '../api-client.js';
import { ApiError } from '../api-error.js';
import { providersContract } from '@agentctl/shared';
import type { AgentDiagnosticsSnapshot, ProviderDiscovery, CustomModel } from '@agentctl/shared';

export interface NativeSessionSummary {
  sessionId: string;
  cwd: string;
  title?: string;
  updatedAt?: string;
  importedSessionId?: string;
}
export interface NativeSessionPage {
  sessions: NativeSessionSummary[];
  nextCursor?: string;
}

async function fetchProviderList(path: string): Promise<ProviderDiscovery[]> {
  const response = await apiClient.fetch<unknown>(path);
  const parsed = providersContract.getProviders.responses[200].safeParse(response);
  if (!parsed.success) {
    throw new ApiError('Invalid agent list. Check the API server connection and try again.', 200);
  }
  return parsed.data;
}

export const providerService = {
  createProfile(providerId: string, name: string): Promise<ProviderDiscovery> {
    return apiClient.fetch(`/api/providers/${encodeURIComponent(providerId)}/profiles`, {
      method: 'POST',
      body: JSON.stringify({ name }),
    });
  },
  listNativeSessions(
    providerId: string,
    projectId: string,
    cursor?: string,
  ): Promise<NativeSessionPage> {
    const query = new URLSearchParams({ projectId, ...(cursor ? { cursor } : {}) });
    return apiClient.fetch(
      `/api/providers/${encodeURIComponent(providerId)}/native-sessions?${query}`,
    );
  },
  importNativeSession(
    providerId: string,
    projectId: string,
    nativeSessionId: string,
    title?: string,
  ): Promise<{ sessionId: string }> {
    return apiClient.fetch('/api/sessions/import-native', {
      method: 'POST',
      body: JSON.stringify({ providerId, projectId, nativeSessionId, title }),
    });
  },
  getTransportDiagnostics() {
    return apiClient.fetch<AgentDiagnosticsSnapshot>('/api/diagnostics/transport');
  },
  getProviders(): Promise<ProviderDiscovery[]> {
    return fetchProviderList('/api/providers');
  },

  getRegistry(): Promise<ProviderDiscovery[]> {
    return fetchProviderList('/api/registry');
  },

  updateSessionProvider(sessionId: string, providerId: string, modelId?: string) {
    return apiClient.fetch(`/api/sessions/${sessionId}`, {
      method: 'PATCH',
      body: JSON.stringify({ providerId, modelId }),
    });
  },

  login(providerId: string, methodId: string) {
    return apiClient.fetch(`/api/providers/${providerId}/login`, {
      method: 'POST',
      body: JSON.stringify({ methodId }),
    });
  },

  respondAuthInteraction(providerId: string, interactionId: string, accepted: boolean) {
    return apiClient.fetch(`/api/providers/${encodeURIComponent(providerId)}/auth/respond`, {
      method: 'POST',
      body: JSON.stringify({ interactionId, accepted }),
    });
  },
  cancelLogin(providerId: string) {
    return apiClient.fetch(`/api/providers/${providerId}/login/cancel`, {
      method: 'POST',
    });
  },

  verify(providerId: string): Promise<ProviderDiscovery> {
    return apiClient.fetch<ProviderDiscovery>(`/api/providers/${providerId}/verify`, {
      method: 'POST',
    });
  },

  logout(providerId: string) {
    return apiClient.fetch(`/api/providers/${providerId}/logout`, {
      method: 'POST',
    });
  },

  activate(providerId: string) {
    return apiClient.fetch(`/api/providers/${providerId}/activate`, {
      method: 'POST',
    });
  },

  sync(): Promise<ProviderDiscovery[]> {
    return apiClient.fetch<ProviderDiscovery[]>('/api/providers/sync', {
      method: 'POST',
    });
  },

  refresh(providerId: string): Promise<ProviderDiscovery> {
    return apiClient.fetch<ProviderDiscovery>(`/api/providers/${providerId}/refresh`, {
      method: 'POST',
    });
  },

  install(providerId: string): Promise<ProviderDiscovery> {
    return apiClient.fetch<ProviderDiscovery>(`/api/providers/${providerId}/install`, {
      method: 'POST',
    });
  },

  cancelInstall(providerId: string) {
    return apiClient.fetch(`/api/providers/${providerId}/install/cancel`, {
      method: 'POST',
    });
  },

  remove(providerId: string): Promise<ProviderDiscovery> {
    return apiClient.fetch<ProviderDiscovery>(`/api/providers/${providerId}/remove`, {
      method: 'POST',
    });
  },

  updateConfig(
    providerId: string,
    customEnv?: Record<string, string>,
    nativelyLoadsSkills?: boolean,
    defaults?: {
      customModels?: CustomModel[];
      protocol?: 'auto' | 'v1' | 'v2';
      defaultModel?: string;
      defaultThinkingEffort?: string;
    },
  ): Promise<ProviderDiscovery> {
    return apiClient.fetch<ProviderDiscovery>(`/api/providers/${providerId}/config`, {
      method: 'POST',
      body: JSON.stringify({ customEnv, nativelyLoadsSkills, ...defaults }),
    });
  },
};
