import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@agentctl/api-client';
import { toast } from 'sonner';

export interface McpServerData {
  id: string;
  name: string;
  command?: string | null;
  launchArgs?: string | null;
  launchEnv?: string | null;
  enabled: boolean;
  autoApprove: boolean;
  type: 'local' | 'remote';
  url?: string | null;
  headers?: string | null;
  status?: 'connected' | 'disconnected' | 'disabled';
  error?: string | null;
}

export function useMcpServers() {
  const queryClient = useQueryClient();

  const { data: mcpServers = [], isLoading } = useQuery<McpServerData[]>({
    queryKey: ['mcpServers'],
    queryFn: () => apiClient.fetch<McpServerData[]>('/api/mcp-servers'),
    refetchInterval: 10000,
  });

  const addMcpServerMutation = useMutation({
    mutationFn: (newServer: Partial<McpServerData>) =>
      apiClient.fetch<McpServerData>('/api/mcp-servers', {
        method: 'POST',
        body: JSON.stringify(newServer),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['mcpServers'] });
      toast.success('MCP server registered successfully');
    },
    onError: (err: Error) => {
      toast.error(`Failed to register MCP server: ${err.message}`);
    },
  });

  const updateMcpServerMutation = useMutation({
    mutationFn: ({ id, ...updates }: Partial<McpServerData> & { id: string }) =>
      apiClient.fetch<McpServerData>(`/api/mcp-servers/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(updates),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['mcpServers'] });
      toast.success('MCP server updated');
    },
    onError: (err: Error) => {
      toast.error(`Failed to update MCP server: ${err.message}`);
    },
  });

  const deleteMcpServerMutation = useMutation({
    mutationFn: (id: string) =>
      apiClient.fetch<{ success: boolean }>(`/api/mcp-servers/${id}`, {
        method: 'DELETE',
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['mcpServers'] });
      toast.success('MCP server deleted');
    },
    onError: (err: Error) => {
      toast.error(`Failed to delete MCP server: ${err.message}`);
    },
  });

  return {
    mcpServers,
    isLoading,
    addMcpServer: addMcpServerMutation.mutate,
    isAdding: addMcpServerMutation.isPending,
    updateMcpServer: updateMcpServerMutation.mutate,
    isUpdating: updateMcpServerMutation.isPending,
    deleteMcpServer: deleteMcpServerMutation.mutate,
    isDeleting: deleteMcpServerMutation.isPending,
  };
}

export interface McpToolData {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  serverId: string;
}

export function useMcpTools() {
  const { data: tools = [], isLoading } = useQuery<McpToolData[]>({
    queryKey: ['mcpTools'],
    queryFn: () => apiClient.fetch<McpToolData[]>('/api/mcp/tools'),
    refetchInterval: 10000,
  });

  return { tools, isLoading };
}
