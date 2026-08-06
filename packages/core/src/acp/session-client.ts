import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { sessions, providers, mcpServers } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import type { createDatabase } from '../db/index.js';
import { type Logger, noopLogger } from '../logger.js';
import type { SessionEventStore } from '../session/event-store.js';
import type {
  DomainPermissionRequest,
  DomainPermissionResponse,
  DomainAgentEvent,
  AgentRuntimeHandle,
} from './types.js';

import type { SessionStateMachine } from '../session/state-machine.js';
import { EventStreamAdapter } from '../session/event-stream-adapter.js';
import type { McpGateway } from '../mcp/mcp-gateway.js';
import { ElicitationStore } from '../session/elicitation-store.js';
import { PermissionEngine } from '../security/permission-engine.js';

import type { ElicitationRequest, ElicitationResponse } from '@agentctl/shared';

export type DbClient = ReturnType<typeof createDatabase>;

interface ParsedUsageMetrics {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  contextLimit?: number;
  cost?: { amount: number; currency: string };
}

function parseUsageMetrics(usage: unknown): ParsedUsageMetrics | null {
  if (!usage || typeof usage !== 'object') return null;
  const raw = usage as Record<string, unknown>;

  const getNum = (...keys: string[]): number | undefined => {
    for (const key of keys) {
      const val = raw[key];
      if (typeof val === 'number' && !isNaN(val)) return val;
      if (typeof val === 'string') {
        const parsed = parseInt(val, 10);
        if (!isNaN(parsed)) return parsed;
      }
    }
    return undefined;
  };

  const inputTokens = getNum('inputTokens', 'input_tokens', 'promptTokens', 'prompt_tokens');
  const outputTokens = getNum(
    'outputTokens',
    'output_tokens',
    'completionTokens',
    'completion_tokens',
  );
  const totalTokens = getNum('totalTokens', 'total_tokens', 'used', 'usedTokens');
  const contextLimit = getNum('contextLimit', 'context_limit', 'size', 'maxTokens');

  let cost: { amount: number; currency: string } | undefined = undefined;
  if (raw.cost && typeof raw.cost === 'object') {
    const c = raw.cost as Record<string, unknown>;
    const amt = typeof c.amount === 'number' ? c.amount : parseFloat(String(c.amount));
    if (!isNaN(amt)) {
      const currencyStr = typeof c.currency === 'string' ? c.currency : 'USD';
      cost = { amount: amt, currency: currencyStr };
    }
  }

  return { inputTokens, outputTokens, totalTokens, contextLimit, cost };
}

export class ACPSession {
  public acpSessionId: string | null = null;
  public elicitationStore = new ElicitationStore();
  public permissionEngine = new PermissionEngine();
  private pendingApprovals = new Map<string, (response: DomainPermissionResponse) => void>();
  private pendingRequests = new Map<string, DomainPermissionRequest>();
  private isStopped = false;
  private stopKind: 'idle' | 'error' | null = null;

  private eventStreamAdapter: EventStreamAdapter;

  public async flushAll(): Promise<void> {
    await this.eventStreamAdapter.flushAll();
  }

  get isDead(): boolean {
    return this.isStopped;
  }

  constructor(
    public sessionId: string,
    private runtimeHandle: AgentRuntimeHandle,
    private db: DbClient,
    public eventStore: SessionEventStore,
    private cwd: string,
    private stateMachine?: SessionStateMachine,
    private logger: Logger = noopLogger,
    private mcpGateway?: McpGateway,
  ) {
    this.acpSessionId = runtimeHandle.acpSessionId;
    this.eventStreamAdapter = new EventStreamAdapter(
      sessionId,
      eventStore,
      logger,
      cwd,
      stateMachine?.getSnapshotService(),
    );

    // Persist available agent personas from initialization
    if (runtimeHandle.availableModes && runtimeHandle.availableModes.length > 0) {
      void this.db
        .update(sessions)
        .set({
          availableAgentPersonas: JSON.stringify(runtimeHandle.availableModes),
        })
        .where(eq(sessions.id, sessionId))
        .catch((err: unknown) => {
          this.logger.error(err, 'Failed to update availableAgentPersonas on init');
        });
    }

    this.runtimeHandle.onProcessError((err) => {
      this.logger.error(err, `Child process error in session ${this.sessionId}`);
      void this.handleError(err).catch((e: unknown) => {
        this.logger.error(e, 'Failed to handle error');
      });
    });

    this.runtimeHandle.onProcessExit(() => {
      if (this.stopKind === 'error') return;

      void this.markSessionStopped('idle').catch((e: unknown) => {
        this.logger.error(e, 'Failed to update session status on exit');
      });
    });

    void this.runtimeHandle.closed
      .then(() => {
        if (this.stopKind === 'error' || this.isStopped) return;

        this.isStopped = true;
        void this.markSessionStopped('idle').catch((e: unknown) => {
          this.logger.error(e, 'Failed to update session status on close');
        });
      })
      .catch(async (error: unknown) => {
        if (this.isStopped) return;
        this.isStopped = true;
        this.logger.error(error, 'Connection closed with error');
        await this.handleError(error);
      });
  }

  private loadSkills(cwd: string): string {
    const skills: string[] = [];

    const readSkillsFromBase = (basePath: string) => {
      try {
        const skillsDir = path.join(basePath, 'skills');
        if (fs.existsSync(skillsDir)) {
          const dirs = fs.readdirSync(skillsDir, { withFileTypes: true });
          for (const dir of dirs) {
            if (dir.isDirectory()) {
              const skillMdPath = path.join(skillsDir, dir.name, 'SKILL.md');
              if (fs.existsSync(skillMdPath)) {
                const content = fs.readFileSync(skillMdPath, 'utf8');
                skills.push(`### Skill: ${dir.name}\n\n${content}`);
              }
            }
          }
        }
      } catch (err: unknown) {
        this.logger.error(err, `Failed to load skills from ${basePath}`);
      }
    };

    // Read workspace skills from .agents directory
    const workspacePath = path.join(cwd, '.agents');
    readSkillsFromBase(workspacePath);

    return skills.join('\n\n---\n\n');
  }

  private async parseAndExecuteMcpCommand(
    text: string,
  ): Promise<{ result: string; toolName: string; args: string } | null> {
    const match = /^\/([a-zA-Z0-9_-]+):([a-zA-Z0-9_:-]+)(.*)$/.exec(text);
    if (!match) return null;

    const [, serverId, shortToolName, rawArgs] = match;
    const toolName = `${serverId}__${shortToolName}`;
    const argsText = rawArgs.trim();

    this.logger.info({ serverId, toolName, argsText }, 'Intercepted manual MCP tool call command');

    if (!this.mcpGateway) {
      throw new Error('MCP gateway not available');
    }

    // Fetch tool definition to determine argument schema
    const tools = await this.mcpGateway.getTools();
    const toolDef = tools.find((t) => t.name === toolName || t.name === shortToolName);

    let parsedArgs: Record<string, unknown> = {};
    if (argsText) {
      try {
        if (argsText.startsWith('{')) {
          parsedArgs = JSON.parse(argsText) as Record<string, unknown>;
        } else {
          // Map plain text to the first required string parameter in the schema if possible
          const schema = toolDef?.inputSchema;
          const properties = schema?.properties as Record<string, { type?: string }> | undefined;
          const required = schema?.required as string[] | undefined;
          const stringParam = Object.entries(properties ?? {}).find(
            ([name, prop]) => prop.type === 'string' && (required ? required.includes(name) : true),
          )?.[0];

          if (stringParam) {
            parsedArgs[stringParam] = argsText;
          } else {
            parsedArgs.query = argsText;
          }
        }
      } catch {
        parsedArgs = { query: argsText };
      }
    }

    try {
      const output = await this.mcpGateway.callTool(serverId, shortToolName, parsedArgs);
      return {
        result: typeof output === 'string' ? output : JSON.stringify(output, null, 2),
        toolName,
        args: JSON.stringify(parsedArgs),
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`MCP tool call failed: ${msg}`);
    }
  }

  writeTerminalInput(terminalId: string, data: string): boolean {
    if (this.runtimeHandle.writeTerminalInput) {
      return this.runtimeHandle.writeTerminalInput(terminalId, data);
    }
    return false;
  }

  async prompt(text: string, attachmentIds?: string[], embeddedContext?: string): Promise<void> {
    try {
      const sessionRecord = await this.db.query.sessions.findFirst({
        where: eq(sessions.id, this.sessionId),
      });

      if (sessionRecord?.title === 'new session') {
        const summary = text.trim();
        const firstLine = summary.split('\n')[0] || '';
        const titleVal = firstLine.length > 40 ? firstLine.slice(0, 40) + '...' : firstLine;
        await this.db
          .update(sessions)
          .set({ title: titleVal || 'new session' })
          .where(eq(sessions.id, this.sessionId));
      }

      if (this.stateMachine) {
        await this.stateMachine.transitionTo(this.sessionId, 'running');
      } else {
        await this.db
          .update(sessions)
          .set({ status: 'running', updatedAt: new Date() })
          .where(eq(sessions.id, this.sessionId));
      }

      interface AttachmentMeta {
        attachmentId: string;
        mimeType: string;
        filename: string;
        sizeBytes: number;
      }

      // Resolve attachments metadata & paths from disk
      const resolvedAttachmentsMeta: AttachmentMeta[] = [];
      const resolvedAttachmentFiles: { filePath: string; mimeType: string }[] = [];

      if (attachmentIds && attachmentIds.length > 0) {
        const sessionAttachmentsDir = path.join(
          os.tmpdir(),
          'agentctl-attachments',
          this.sessionId,
        );
        for (const id of attachmentIds) {
          const jsonPath = path.join(sessionAttachmentsDir, `${id}.json`);
          const binPath = path.join(sessionAttachmentsDir, `${id}.bin`);
          if (fs.existsSync(jsonPath) && fs.existsSync(binPath)) {
            try {
              const content = fs.readFileSync(jsonPath, 'utf8');
              const meta = JSON.parse(content) as AttachmentMeta;

              if (meta.attachmentId && meta.mimeType) {
                resolvedAttachmentsMeta.push(meta);
                resolvedAttachmentFiles.push({
                  filePath: binPath,
                  mimeType: meta.mimeType,
                });
              } else {
                this.logger.warn(`Malformed attachment metadata at ${jsonPath}`);
              }
            } catch (err) {
              this.logger.error(err, `Failed to read/parse attachment metadata for ${id}`);
            }
          }
        }
      }

      let promptText = text;
      let isManualMcp = false;
      const promptTokens = Math.ceil(text.length / 4);

      if (text.startsWith('/')) {
        try {
          const executed = await this.parseAndExecuteMcpCommand(text);
          if (executed) {
            isManualMcp = true;
            // Wrap for agent context
            promptText = `[System Notification: The user manually executed the tool "${executed.toolName}" with args: "${executed.args}". Result:\n---\n${executed.result}\n---\nAnalyze this output and answer the user's request.]`;

            // Persist user command
            await this.eventStreamAdapter.startTurn(text, resolvedAttachmentsMeta, promptTokens);
            // Yield result to user timeline feed
            await this.eventStreamAdapter.appendText(
              `\n\n*Manual Tool Execution Result [${executed.toolName}]:*\n\`\`\`json\n${executed.result}\n\`\`\`\n`,
            );
            await this.flushAll();
          }
        } catch (err: unknown) {
          isManualMcp = true;
          const msg = err instanceof Error ? err.message : String(err);
          // Persist user command
          await this.eventStreamAdapter.startTurn(text, resolvedAttachmentsMeta, promptTokens);
          // Stream execution error to UI
          await this.eventStreamAdapter.appendText(
            `\n\n*Manual Tool Execution Error:*\n> ${msg}\n`,
          );
          await this.flushAll();

          // Emit turn_end status event
          await this.eventStore.append(
            this.sessionId,
            'status',
            { status: 'turn_end', stopReason: 'error' },
            null,
          );

          if (this.stateMachine) {
            await this.stateMachine.transitionTo(this.sessionId, 'idle');
          } else {
            await this.db
              .update(sessions)
              .set({ status: 'idle', updatedAt: new Date() })
              .where(eq(sessions.id, this.sessionId));
          }
          return; // Do not call the model if direct execution failed
        }
      }

      if (!isManualMcp) {
        // Persist user message immediately so it shows up in history
        await this.eventStreamAdapter.startTurn(text, resolvedAttachmentsMeta, promptTokens);
      }

      let nativelyLoadsSkills = false;
      if (sessionRecord?.selectedProvider) {
        const providerRecord = await this.db.query.providers.findFirst({
          where: eq(providers.id, sessionRecord.selectedProvider),
        });
        if (providerRecord) {
          nativelyLoadsSkills = providerRecord.nativelyLoadsSkills;
        }
      }

      const skillsContext = nativelyLoadsSkills ? '' : this.loadSkills(this.cwd);
      const finalEmbeddedContext = [embeddedContext, skillsContext]
        .filter(Boolean)
        .join('\n\n---\n\n');

      const promptResult = await this.runtimeHandle.prompt(
        promptText,
        resolvedAttachmentFiles,
        finalEmbeddedContext || undefined,
      );

      await this.flushAll();

      // Store turn end with stopReason and per-turn usage
      const turnData: Record<string, unknown> = {
        status: 'turn_end',
        stopReason: promptResult.stopReason,
      };

      if (promptResult.usage) {
        const metrics = parseUsageMetrics(promptResult.usage);
        if (metrics) {
          turnData.usage = metrics;

          const sessionRecord = await this.db.query.sessions.findFirst({
            where: eq(sessions.id, this.sessionId),
          });
          if (sessionRecord) {
            let existingMetrics: Record<string, unknown> = {};
            try {
              existingMetrics = JSON.parse(sessionRecord.sessionMetrics) as Record<string, unknown>;
            } catch {
              existingMetrics = {};
            }

            const currentInput =
              typeof existingMetrics.inputTokens === 'number' ? existingMetrics.inputTokens : 0;
            const currentOutput =
              typeof existingMetrics.outputTokens === 'number' ? existingMetrics.outputTokens : 0;

            const newInput = currentInput + (metrics.inputTokens ?? 0);
            const newOutput = currentOutput + (metrics.outputTokens ?? 0);
            const newTotal = metrics.totalTokens ?? newInput + newOutput;
            const newContextLimit = metrics.contextLimit ?? sessionRecord.contextLimit;
            const newCost = metrics.cost
              ? sessionRecord.estimatedCost + metrics.cost.amount
              : sessionRecord.estimatedCost;

            const updatedMetrics = {
              ...existingMetrics,
              inputTokens: newInput,
              outputTokens: newOutput,
              totalTokens: newTotal,
              contextLimit: newContextLimit,
              estimatedCost: newCost,
              lastTurn: metrics,
            };

            await this.db
              .update(sessions)
              .set({
                totalTokens: newTotal,
                contextLimit: newContextLimit,
                estimatedCost: newCost,
                sessionMetrics: JSON.stringify(updatedMetrics),
                updatedAt: new Date(),
              })
              .where(eq(sessions.id, this.sessionId));
          }
        } else {
          turnData.usage = promptResult.usage;
        }
      }
      if (promptResult.userMessageId) {
        turnData.userMessageId = promptResult.userMessageId;
      }
      await this.eventStore.append(this.sessionId, 'status', turnData, null);

      if (this.stateMachine) {
        await this.stateMachine.transitionTo(this.sessionId, 'idle');
      } else {
        await this.db
          .update(sessions)
          .set({ status: 'idle', updatedAt: new Date() })
          .where(eq(sessions.id, this.sessionId));
      }
    } catch (error: unknown) {
      await this.flushAll();
      await this.handleError(error);
      throw error;
    }
  }

  private getBestOption(options?: { optionId: string; label?: string }[]): string | undefined {
    if (!options || options.length === 0) return undefined;

    const negativeKeywords = ['deny', 'cancel', 'reject', 'block', 'no'];
    const positiveOptions = options.filter((o) => {
      const id = o.optionId.toLowerCase();
      const label = (o.label ?? '').toLowerCase();
      return !negativeKeywords.some((neg) => id.includes(neg) || label.includes(neg));
    });

    if (positiveOptions.length === 0) {
      return options[0].optionId;
    }

    let best = positiveOptions.find((o) => {
      const id = o.optionId.toLowerCase();
      return id.includes('always') || id.includes('session') || id.includes('forever');
    });

    if (!best) {
      const positiveKeywords = ['allow', 'approve', 'yes', 'grant', 'confirm', 'ok'];
      best = positiveOptions.find((o) => {
        const id = o.optionId.toLowerCase();
        const label = (o.label ?? '').toLowerCase();
        return positiveKeywords.some((pos) => id.includes(pos) || label.includes(pos));
      });
    }

    best ??= positiveOptions[0];

    return best.optionId;
  }

  resolvePermission(permissionId: string, response: DomainPermissionResponse): void {
    const resolve = this.pendingApprovals.get(permissionId);
    if (resolve) {
      const request = this.pendingRequests.get(permissionId);
      this.pendingRequests.delete(permissionId);

      let finalResponse = response;
      if (response.allowed && request) {
        const reqOptions = request.options;
        if (reqOptions && reqOptions.length > 0) {
          const hasOption = reqOptions.some((o) => o.optionId === response.optionId);
          if (!hasOption) {
            const bestOptionId = this.getBestOption(reqOptions);
            finalResponse = {
              allowed: true,
              optionId: bestOptionId ?? reqOptions[0].optionId,
            };
          }
        } else {
          // If no options are provided by the agent, do not send any optionId
          finalResponse = {
            allowed: true,
          };
        }
      }

      if (finalResponse.allowed) {
        this.permissionEngine.applyOutcome({
          option_id: finalResponse.optionId ?? 'allow_once',
          option_kind: finalResponse.optionId === 'allow_always' ? 'allow_always' : 'allow_once',
          params: (response as { params?: Record<string, unknown> }).params,
        });
      }

      resolve(finalResponse);
      this.pendingApprovals.delete(permissionId);

      const eventId = Number(permissionId);
      if (!isNaN(eventId)) {
        void this.eventStore.getEvent(eventId).then(async (event) => {
          if (event) {
            const currentData = event.data as Record<string, unknown>;
            const allowed = finalResponse.allowed;
            await this.eventStore.update(eventId, {
              ...currentData,
              status: allowed ? 'approved' : 'denied',
            });
          }
        });
      }
    }
  }

  async requestElicitation(request: ElicitationRequest): Promise<ElicitationResponse> {
    const { item, promise } = this.elicitationStore.createElicitation(request);

    await this.eventStore.append(
      this.sessionId,
      'status',
      {
        status: 'elicitation_requested',
        request,
        elicitation: item,
      },
      null,
    );

    return promise;
  }

  respondToElicitation(elicitationId: string, response: ElicitationResponse): boolean {
    const ok = this.elicitationStore.respondToElicitation(elicitationId, response);
    if (ok) {
      void this.eventStore.append(
        this.sessionId,
        'status',
        {
          status: 'elicitation_responded',
          elicitationId,
          response,
        },
        null,
      );
    }
    return ok;
  }

  cancelElicitation(elicitationId: string): boolean {
    return this.respondToElicitation(elicitationId, { action: 'cancel' });
  }

  kill(): void {
    if (this.isStopped) return;

    this.isStopped = true;
    this.pendingApprovals.clear();

    void this.flushAll().catch((err: unknown) => {
      this.logger.error(err, 'Failed to flush buffers in kill()');
    });

    void this.runtimeHandle.stop();
  }

  async authenticate(methodId: string): Promise<void> {
    await this.runtimeHandle.authenticate(methodId);
  }

  async cancel(): Promise<void> {
    for (const [permissionId, resolve] of this.pendingApprovals) {
      this.pendingRequests.delete(permissionId);
      resolve({ allowed: false });
    }
    this.pendingApprovals.clear();

    await this.runtimeHandle.cancel();
  }

  async stop(): Promise<void> {
    await this.flushAll();
    this.kill();
    await this.markSessionStopped('idle');
  }

  async updateModel(modelId: string): Promise<void> {
    if (this.isStopped) return;
    if (typeof this.runtimeHandle.updateModel === 'function') {
      await this.runtimeHandle.updateModel(modelId);
    }
  }

  async updateConfigOption(configId: string, value: string | boolean): Promise<void> {
    if (this.isStopped) return;
    if (typeof this.runtimeHandle.updateConfigOption === 'function') {
      try {
        const configOptions = await this.runtimeHandle.updateConfigOption(configId, value);
        if (configOptions.length > 0) {
          await this.db
            .update(sessions)
            .set({
              sessionConfigOptions: JSON.stringify(configOptions),
              updatedAt: new Date(),
            })
            .where(eq(sessions.id, this.sessionId));
          await this.eventStore.append(
            this.sessionId,
            'status',
            {
              status: 'config_option_update',
              configOptions,
            },
            null,
          );
        }
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        this.logger.error(err, `Failed to update config option ${configId} to ${String(value)}`);
        await this.eventStore.append(
          this.sessionId,
          'status',
          {
            status: 'config_option_error',
            configId,
            value,
            error: errorMessage,
          },
          null,
        );
        throw err;
      }
    }
  }

  async setMode(modeId: string): Promise<void> {
    if (this.isStopped) return;
    if (typeof this.runtimeHandle.setMode === 'function') {
      await this.runtimeHandle.setMode(modeId);
    }
  }

  private async handleError(error: unknown): Promise<void> {
    this.logger.error(error, `Error in ACPSession ${this.sessionId}`);
    this.stopKind = 'error';
    await this.flushAll();
    this.kill();
    await this.markSessionStopped('error');
  }

  private async markSessionStopped(status: 'idle' | 'error'): Promise<void> {
    this.stopKind = status;
    if (this.stateMachine) {
      await this.stateMachine.transitionTo(this.sessionId, status);
    } else {
      if (status === 'idle') {
        await this.db
          .update(sessions)
          .set({ status: 'idle', closedAt: new Date() })
          .where(eq(sessions.id, this.sessionId));
      } else {
        await this.db
          .update(sessions)
          .set({ status: 'error', updatedAt: new Date() })
          .where(eq(sessions.id, this.sessionId));
      }
    }
  }

  public async handleDomainEvent(event: DomainAgentEvent): Promise<void> {
    try {
      switch (event.type) {
        case 'tool_call':
          await this.eventStreamAdapter.registerToolCall(event.call, event.isUpdate);
          break;
        case 'text':
          await this.eventStreamAdapter.appendText(event.text);
          break;
        case 'thought':
          await this.eventStreamAdapter.appendThought(event.text);
          break;
        case 'status':
          await this.eventStore.append(
            this.sessionId,
            'status',
            {
              status: event.status,
              title: event.title,
            },
            null,
          );
          break;
        case 'usage_update':
          await this.db
            .update(sessions)
            .set({
              totalTokens: event.used,
              contextLimit: event.size,
              estimatedCost: event.cost ? event.cost.amount : 0.0,
              updatedAt: new Date(),
            })
            .where(eq(sessions.id, this.sessionId));

          await this.eventStore.append(
            this.sessionId,
            'status',
            {
              status: 'usage_update',
              totalTokens: event.used,
              contextLimit: event.size,
            },
            null,
          );
          break;
        case 'available_commands_update':
          await this.db
            .update(sessions)
            .set({
              availableCommands: JSON.stringify(event.commands),
              updatedAt: new Date(),
            })
            .where(eq(sessions.id, this.sessionId));

          await this.eventStore.append(
            this.sessionId,
            'status',
            {
              status: 'available_commands_update',
              availableCommands: event.commands,
            },
            null,
          );
          break;
        case 'plan_update': {
          const sanitizedPlan = Array.isArray(event.plan)
            ? event.plan.map((item) => ({
                name: item.name || 'unnamed task',
                status: ['pending', 'in_progress', 'completed'].includes(item.status)
                  ? item.status
                  : 'pending',
                isCompleted: item.isCompleted,
                priority: item.priority,
              }))
            : [];

          await this.db
            .update(sessions)
            .set({
              plan: JSON.stringify(sanitizedPlan),
              updatedAt: new Date(),
            })
            .where(eq(sessions.id, this.sessionId));

          await this.eventStore.append(
            this.sessionId,
            'plan_update',
            {
              plan: sanitizedPlan,
            },
            null,
          );
          break;
        }
        case 'metrics_update':
          await this.db
            .update(sessions)
            .set({
              sessionMetrics: JSON.stringify(event.metrics),
              updatedAt: new Date(),
            })
            .where(eq(sessions.id, this.sessionId));
          break;
        case 'config_option_update':
          await this.db
            .update(sessions)
            .set({
              sessionConfigOptions: JSON.stringify(event.configOptions),
              updatedAt: new Date(),
            })
            .where(eq(sessions.id, this.sessionId));

          await this.eventStore.append(
            this.sessionId,
            'status',
            {
              status: 'config_option_update',
              configOptions: event.configOptions,
            },
            null,
          );
          break;
        case 'terminal_created':
          await this.eventStore.append(
            this.sessionId,
            'terminal_created',
            {
              terminalId: event.terminalId,
              command: event.command,
            },
            null,
          );
          break;
        case 'terminal_output':
          await this.eventStore.append(
            this.sessionId,
            'terminal_output',
            {
              terminalId: event.terminalId,
              data: event.data,
            },
            null,
          );
          break;
        case 'terminal_exit':
          await this.eventStore.append(
            this.sessionId,
            'terminal_exit',
            {
              terminalId: event.terminalId,
              code: event.code,
            },
            null,
          );
          break;
        case 'mode_update': {
          const acpMode = event.modeId;

          await this.db
            .update(sessions)
            .set({
              agentPersona: acpMode,
              updatedAt: new Date(),
            })
            .where(eq(sessions.id, this.sessionId));

          await this.eventStore.append(
            this.sessionId,
            'status',
            {
              status: 'mode_update',
              modeId: event.modeId,
            },
            null,
          );
          break;
        }
        case 'session_info_update': {
          const updateObj: Record<string, unknown> = {
            updatedAt: new Date(),
          };
          if (typeof event.title === 'string') {
            updateObj.title = event.title;
          }
          await this.db.update(sessions).set(updateObj).where(eq(sessions.id, this.sessionId));

          await this.eventStore.append(
            this.sessionId,
            'status',
            {
              status: 'session_info_update',
              title: event.title,
              updatedAt: event.updatedAt,
            },
            null,
          );
          break;
        }
      }
    } catch (error) {
      await this.handleError(error).catch((e: unknown) => {
        this.logger.error(e, 'Failed to handle error in handleDomainEvent');
      });
    }
  }

  public async handleRequestPermission(
    request: DomainPermissionRequest,
  ): Promise<DomainPermissionResponse> {
    try {
      const permissionId = request.toolCall.toolCallId ?? Math.random().toString(36).substring(7);
      const parentId = this.eventStreamAdapter.getCurrentParentEventId();

      const sessionRecord = await this.db.query.sessions.findFirst({
        where: eq(sessions.id, this.sessionId),
      });

      const toolName = request.toolCall.name;
      const toolArgs = request.toolCall.arguments ?? {};

      if (this.permissionEngine.isToolCallApproved(toolName, toolArgs)) {
        await this.eventStore.append(
          this.sessionId,
          'approval_request',
          {
            name: 'request_permission',
            toolCallId: permissionId,
            requiresApproval: false,
            request,
            status: 'approved',
            patternAutoApproved: true,
          },
          parentId,
        );
        return { allowed: true };
      }

      let shouldAutoApprove =
        sessionRecord?.approvalMode === 'yolo' ||
        (sessionRecord?.approvalMode === 'auto_approve' && toolName.startsWith('fs/'));

      if (
        !shouldAutoApprove &&
        sessionRecord?.approvalMode === 'auto_approve' &&
        toolName.includes('__')
      ) {
        const serverId = toolName.split('__')[0];
        const shortToolName = toolName.split('__').slice(1).join('__');
        const mcpServer = await this.db.query.mcpServers.findFirst({
          where: eq(mcpServers.id, serverId),
        });

        if (mcpServer) {
          let override: 'always_prompt' | 'auto_approve' | 'deny' | undefined = undefined;
          if (mcpServer.toolPermissions) {
            try {
              const overridesMap = JSON.parse(mcpServer.toolPermissions) as Record<string, string>;
              override = overridesMap[shortToolName] as 'always_prompt' | 'auto_approve' | 'deny';
            } catch {
              // ignore
            }
          }

          if (override === 'auto_approve') {
            shouldAutoApprove = true;
          } else if (override === 'always_prompt') {
            shouldAutoApprove = false;
          } else if (override === 'deny') {
            await this.eventStore.append(
              this.sessionId,
              'approval_request',
              {
                name: 'request_permission',
                toolCallId: permissionId,
                requiresApproval: true,
                request,
                status: 'denied',
              },
              parentId,
            );
            return { allowed: false };
          } else {
            // Fall back to server default policy
            if (mcpServer.approvalPolicy === 'auto_approve_all') {
              shouldAutoApprove = true;
            } else if (mcpServer.approvalPolicy === 'deny_all') {
              await this.eventStore.append(
                this.sessionId,
                'approval_request',
                {
                  name: 'request_permission',
                  toolCallId: permissionId,
                  requiresApproval: true,
                  request,
                  status: 'denied',
                },
                parentId,
              );
              return { allowed: false };
            } else {
              shouldAutoApprove = false;
            }
          }
        }
      }

      if (shouldAutoApprove) {
        await this.eventStore.append(
          this.sessionId,
          'approval_request',
          {
            name: 'request_permission',
            toolCallId: permissionId,
            requiresApproval: true,
            request,
            status: 'approved',
          },
          parentId,
        );

        const reqOptions = request.options;
        if (reqOptions && reqOptions.length > 0) {
          const bestOptionId = this.getBestOption(reqOptions);
          return {
            allowed: true,
            optionId: bestOptionId ?? reqOptions[0].optionId,
          };
        }

        return {
          allowed: true,
        };
      }

      if (this.stateMachine) {
        await this.stateMachine.transitionTo(this.sessionId, 'needs_attention');
      } else {
        await this.db
          .update(sessions)
          .set({ status: 'needs_attention', lastHeartbeat: new Date() })
          .where(eq(sessions.id, this.sessionId));
      }

      const permissionOptions = this.permissionEngine.buildPermissionOptions(toolName, toolArgs);

      const eventId = await this.eventStore.append(
        this.sessionId,
        'approval_request',
        {
          name: 'request_permission',
          toolCallId: permissionId,
          requiresApproval: true,
          request,
          permissionOptions,
          status: 'pending',
        },
        parentId,
      );

      const approvalPromise = new Promise<DomainPermissionResponse>((resolve) => {
        this.pendingRequests.set(String(eventId), request);
        this.pendingApprovals.set(String(eventId), resolve);
      });

      return await Promise.race([
        approvalPromise,
        this.runtimeHandle.closed.then(() => {
          this.pendingRequests.delete(String(eventId));
          return {
            allowed: false,
          };
        }),
      ]);
    } catch (error) {
      await this.handleError(error);
      throw error;
    }
  }
}
