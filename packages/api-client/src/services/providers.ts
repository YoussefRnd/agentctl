import { apiClient } from '../api-client.js';
import type { AgentDiagnosticsSnapshot, ProviderDiscovery } from '@agentctl/shared';

export const providerService = {
  getTransportDiagnostics() {
    return apiClient.fetch<AgentDiagnosticsSnapshot>('/api/diagnostics/transport');
  },
  getProviders(): Promise<ProviderDiscovery[]> {
    return apiClient.fetch<ProviderDiscovery[]>('/api/providers');
  },

  getRegistry(): Promise<ProviderDiscovery[]> {
    return apiClient.fetch<ProviderDiscovery[]>('/api/registry');
  },

  updateSessionProvider(sessionId: string, providerId: string, modelId?: string) {
    return apiClient.fetch(`/api/sessions/${sessionId}/provider`, {
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

  remove(providerId: string): Promise<ProviderDiscovery> {
    return apiClient.fetch<ProviderDiscovery>(`/api/providers/${providerId}/remove`, {
      method: 'POST',
    });
  },

  updateConfig(
    providerId: string,
    customEnv?: Record<string, string>,
    nativelyLoadsSkills?: boolean,
  ): Promise<ProviderDiscovery> {
    return apiClient.fetch<ProviderDiscovery>(`/api/providers/${providerId}/config`, {
      method: 'POST',
      body: JSON.stringify({ customEnv, nativelyLoadsSkills }),
    });
  },
};
