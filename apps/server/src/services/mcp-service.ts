import { eq } from 'drizzle-orm';
import { mcpServers, type DbClient } from '@agentctl/core/db';
import type { McpGateway } from '@agentctl/core/mcp';
import { mcpContract, type McpToolResult } from '@agentctl/shared';
import type { z } from 'zod';
import type { FastifyBaseLogger } from 'fastify';
import type { EventBus } from '../utils/event-bus.js';
import { AppError } from '../errors/app-error.js';

export interface ApprovalPresence {
  approvalPolicySent: boolean;
  autoApproveSent: boolean;
}

export class McpService {
  constructor(
    private readonly db: DbClient,
    private readonly gateway: McpGateway,
    private readonly events: Pick<EventBus, 'publishState'>,
    private readonly log: FastifyBaseLogger,
  ) {}
  async getMcpServers() {
    const servers = await this.db.select().from(mcpServers);
    return servers.map((s) => {
      let status: 'connected' | 'disconnected' | 'disabled' = 'disabled';
      if (s.enabled) {
        status = this.gateway.isServerConnected(s.id) ? 'connected' : 'disconnected';
      }
      return {
        id: s.id,
        name: s.name,
        command: s.command,
        launchArgs: s.launchArgs,
        launchEnv: s.launchEnv,
        enabled: s.enabled,
        autoApprove: s.autoApprove,
        approvalPolicy: s.approvalPolicy,
        toolPermissions: s.toolPermissions,
        type: s.type as 'local' | 'remote',
        url: s.url,
        headers: s.headers,
        status,
        error: this.gateway.getConnectionError(s.id) ?? null,
      };
    });
  }
  async createMcpServer(
    body: z.infer<typeof mcpContract.createMcpServer.body>,
    presence: ApprovalPresence,
  ) {
    const { approvalPolicySent, autoApproveSent } = presence;

    let approvalPolicy = body.approvalPolicy;
    let autoApprove = body.autoApprove;

    if (!approvalPolicySent && autoApproveSent) {
      approvalPolicy = autoApprove ? 'auto_approve_all' : 'always_prompt';
    } else if (approvalPolicySent) {
      autoApprove = approvalPolicy === 'auto_approve_all';
    }

    const [created] = await this.db
      .insert(mcpServers)
      .values({
        id: body.id,
        name: body.name,
        command: body.command ?? null,
        launchArgs: body.launchArgs ?? '[]',
        launchEnv: body.launchEnv ?? '{}',
        enabled: body.enabled,
        autoApprove,
        approvalPolicy,
        toolPermissions: body.toolPermissions ?? '{}',
        type: body.type,
        url: body.url ?? null,
        headers: body.headers ?? null,
      })
      .returning();
    try {
      await this.gateway.reload();
    } catch (err: unknown) {
      this.log.error(err, 'Failed to reload MCP gateway on createMcpServer');
    }
    const isConnected = created.enabled && this.gateway.isServerConnected(created.id);
    this.events.publishState({ topics: ['mcp'] });
    return {
      id: created.id,
      name: created.name,
      command: created.command,
      launchArgs: created.launchArgs,
      launchEnv: created.launchEnv,
      enabled: created.enabled,
      autoApprove: created.autoApprove,
      approvalPolicy: created.approvalPolicy,
      toolPermissions: created.toolPermissions,
      type: created.type as 'local' | 'remote',
      url: created.url,
      status: (created.enabled ? (isConnected ? 'connected' : 'disconnected') : 'disabled') as
        'connected' | 'disconnected' | 'disabled',
    };
  }
  async updateMcpServer(
    id: string,
    body: z.infer<typeof mcpContract.updateMcpServer.body>,
    presence: ApprovalPresence,
  ) {
    const { approvalPolicySent, autoApproveSent } = presence;

    let approvalPolicy = body.approvalPolicy;
    let autoApprove = body.autoApprove;

    if (!approvalPolicySent && autoApproveSent) {
      approvalPolicy = autoApprove ? 'auto_approve_all' : 'always_prompt';
    } else if (approvalPolicySent) {
      autoApprove = approvalPolicy === 'auto_approve_all';
    }

    const results = await this.db
      .update(mcpServers)
      .set({
        name: body.name,
        command: body.command === undefined ? undefined : (body.command ?? null),
        launchArgs: body.launchArgs === null ? undefined : body.launchArgs,
        launchEnv: body.launchEnv === null ? undefined : body.launchEnv,
        enabled: body.enabled,
        autoApprove,
        approvalPolicy,
        toolPermissions: body.toolPermissions === null ? '{}' : body.toolPermissions,
        type: body.type,
        url: body.url === undefined ? undefined : (body.url ?? null),
        headers: body.headers === undefined ? undefined : (body.headers ?? null),
        updatedAt: new Date(),
      })
      .where(eq(mcpServers.id, id))
      .returning();
    if (results.length === 0) {
      throw new AppError('MCP server config not found', 404);
    }
    try {
      await this.gateway.reload();
    } catch (err: unknown) {
      this.log.error(err, 'Failed to reload MCP gateway on updateMcpServer');
    }
    const updated = results[0];
    const isConnected = updated.enabled && this.gateway.isServerConnected(updated.id);
    this.events.publishState({ topics: ['mcp'] });
    return {
      id: updated.id,
      name: updated.name,
      command: updated.command,
      launchArgs: updated.launchArgs,
      launchEnv: updated.launchEnv,
      enabled: updated.enabled,
      autoApprove: updated.autoApprove,
      approvalPolicy: updated.approvalPolicy,
      toolPermissions: updated.toolPermissions,
      type: updated.type as 'local' | 'remote',
      url: updated.url,
      headers: updated.headers,
      status: (updated.enabled ? (isConnected ? 'connected' : 'disconnected') : 'disabled') as
        'connected' | 'disconnected' | 'disabled',
    };
  }
  async deleteMcpServer(id: string) {
    const result = await this.db.delete(mcpServers).where(eq(mcpServers.id, id)).returning();
    void this.gateway.reload().catch((err: unknown) => {
      this.log.error(err, 'Failed to reload MCP gateway on deleteMcpServer');
    });
    if (result.length === 0) {
      throw new AppError('MCP server not found', 404);
    }
    this.events.publishState({ topics: ['mcp'] });
    return undefined;
  }
  async getMcpTools() {
    const tools = await this.gateway.getTools();
    return tools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
      serverId: t.serverId,
    }));
  }
  async callMcpTool(body: z.infer<typeof mcpContract.callMcpTool.body>) {
    const { serverId, toolName, arguments: args } = body;
    const result = await this.gateway.callTool(serverId, toolName, args);
    return result as McpToolResult;
  }
}
