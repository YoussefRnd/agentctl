import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { sessions, providers, mcpServers } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import type { DbClient } from '../db/index.js';
import { type Logger, noopLogger } from '../logger.js';
import type { SessionEventStoreLike, SessionStatusTransitioner } from '../session/contracts.js';
import type {
  AgentMcpGateway,
  AgentPermissionRequest,
  AgentPermissionResponse,
  AgentSession,
  AgentUpdate,
  AgentUsage,
} from '../agent/types.js';

import { SessionProjector } from '../session/session-projector.js';
import { ElicitationStore } from '../session/elicitation-store.js';
import { PermissionEngine } from '../security/permission-engine.js';
import { SkillRegistry, type SkillActivation } from '../skills/registry.js';
import {
  getBestPermissionOption,
  isPersistentPermissionOption,
} from '../security/permission-options.js';

import {
  isDefaultSessionTitle,
  type ElicitationRequest,
  type ElicitationResponse,
} from '@agentctl/shared';
import { jsonCodecs } from '../db/json-codecs.js';

function isDeniedOption(optionId?: string): boolean {
  return optionId ? /deny|reject|cancel|block|no/i.test(optionId) : false;
}

export class ManagedSession {
  public agentSessionId: string | null = null;
  public elicitationStore = new ElicitationStore();
  public permissionEngine = new PermissionEngine();
  private pendingApprovals = new Map<string, (response: AgentPermissionResponse) => void>();
  private pendingRequests = new Map<string, AgentPermissionRequest>();
  private isStopped = false;
  private stopKind: 'idle' | 'error' | null = null;
  private needsHistoryContext = false;

  private projector: SessionProjector;

  public async flushAll(): Promise<void> {
    await this.projector.flushAll();
  }

  /** Full-content snapshots of in-flight streaming events (SSE resync). */
  public getLiveEventSnapshots(): ReturnType<SessionProjector['getTransientSnapshots']> {
    return this.projector.getTransientSnapshots();
  }

  get isDead(): boolean {
    return this.isStopped;
  }

  get requiresHistoryContext(): boolean {
    return this.needsHistoryContext;
  }

  markHistoryContextTransferred(): void {
    this.needsHistoryContext = false;
  }

  constructor(
    public sessionId: string,
    private runtimeHandle: AgentSession,
    private db: DbClient,
    public eventStore: SessionEventStoreLike,
    private cwd: string,
    private stateMachine?: SessionStatusTransitioner,
    private logger: Logger = noopLogger,
    private mcpGateway?: AgentMcpGateway,
  ) {
    this.agentSessionId = runtimeHandle.id;
    this.needsHistoryContext = runtimeHandle.history === 'fresh';
    this.projector = new SessionProjector(
      sessionId,
      db,
      eventStore,
      logger,
      cwd,
      stateMachine?.getSnapshotService?.(),
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

    this.runtimeHandle.onError((err) => {
      this.logger.error(err, `Child process error in session ${this.sessionId}`);
      this.rejectPendingApprovals();
      void this.handleError(err).catch((e: unknown) => {
        this.logger.error(e, 'Failed to handle error');
      });
    });

    this.runtimeHandle.onClose(() => {
      this.rejectPendingApprovals();
      if (this.stopKind === 'error') return;

      void this.markSessionStopped('idle').catch((e: unknown) => {
        this.logger.error(e, 'Failed to update session status on exit');
      });
    });

    void this.runtimeHandle.closed
      .then(() => {
        this.rejectPendingApprovals();
        if (this.stopKind === 'error' || this.isStopped) return;

        this.isStopped = true;
        void this.markSessionStopped('idle').catch((e: unknown) => {
          this.logger.error(e, 'Failed to update session status on close');
        });
      })
      .catch(async (error: unknown) => {
        this.rejectPendingApprovals();
        if (this.isStopped) return;
        this.isStopped = true;
        this.logger.error(error, 'Connection closed with error');
        await this.handleError(error);
      });
  }

  private rejectPendingApprovals(): void {
    for (const [, resolve] of this.pendingApprovals.entries()) {
      resolve({ allowed: false });
    }
    this.pendingApprovals.clear();
    this.pendingRequests.clear();
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

  async prompt(
    text: string,
    attachmentIds?: string[],
    embeddedContext?: string,
    skillActivation?: SkillActivation,
  ): Promise<void> {
    try {
      const sessionRecord = await this.db.query.sessions.findFirst({
        where: eq(sessions.id, this.sessionId),
      });

      if (sessionRecord && isDefaultSessionTitle(sessionRecord.title, sessionRecord.taskSlug)) {
        const summary = text.trim();
        const firstLine = summary.split('\n')[0] || '';
        const titleVal = firstLine.length > 40 ? firstLine.slice(0, 40) + '...' : firstLine;
        await this.db
          .update(sessions)
          .set({ title: titleVal || sessionRecord.title })
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
      let startSnapshotHash: string | undefined;
      const promptTokens = Math.ceil(text.length / 4);

      if (text.startsWith('/')) {
        try {
          const executed = await this.parseAndExecuteMcpCommand(text);
          if (executed) {
            isManualMcp = true;
            // Wrap for agent context
            promptText = `[System Notification: The user manually executed the tool "${executed.toolName}" with args: "${executed.args}". Result:\n---\n${executed.result}\n---\nAnalyze this output and answer the user's request.]`;

            // Persist user command
            ({ snapshotHash: startSnapshotHash } = await this.projector.startTurn(
              text,
              resolvedAttachmentsMeta,
              promptTokens,
            ));
            // Yield result to user timeline feed
            await this.projector.appendText(
              `\n\n*Manual Tool Execution Result [${executed.toolName}]:*\n\`\`\`json\n${executed.result}\n\`\`\`\n`,
            );
            await this.flushAll();
          }
        } catch (err: unknown) {
          isManualMcp = true;
          const msg = err instanceof Error ? err.message : String(err);
          // Persist user command
          ({ snapshotHash: startSnapshotHash } = await this.projector.startTurn(
            text,
            resolvedAttachmentsMeta,
            promptTokens,
          ));
          // Stream execution error to UI
          await this.projector.appendText(`\n\n*Manual Tool Execution Error:*\n> ${msg}\n`);
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
        ({ snapshotHash: startSnapshotHash } = await this.projector.startTurn(
          text,
          resolvedAttachmentsMeta,
          promptTokens,
        ));
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

      const requestedSkill = /^\/([a-z0-9-]+)(?:\s|$)/i.exec(text)?.[1]?.toLowerCase();
      const registry = await SkillRegistry.load({
        cwd: this.cwd,
        includeWorkspaceSkills: !nativelyLoadsSkills,
      });
      const activation = skillActivation ?? (requestedSkill ? { name: requestedSkill } : undefined);
      if (skillActivation && !registry.activate(skillActivation)) {
        const requested = skillActivation.name ?? `purpose "${skillActivation.purpose}"`;
        throw new Error(`Agent skill not found: ${requested}`);
      }
      const skillsContext = registry.formatContext(activation);
      const finalEmbeddedContext = [embeddedContext, skillsContext]
        .filter(Boolean)
        .join('\n\n---\n\n');

      const snapshotService = this.stateMachine?.getSnapshotService?.();

      const promptResult = await this.runtimeHandle.prompt(
        promptText,
        resolvedAttachmentFiles,
        finalEmbeddedContext || undefined,
      );

      await this.flushAll();
      await this.projector.finalizeInFlightToolCalls();

      // Store turn end with stopReason, per-turn usage, and centralized turn changes
      const turnData: Record<string, unknown> = {
        status: 'turn_end',
        stopReason: promptResult.stopReason,
      };

      if (snapshotService && this.cwd && startSnapshotHash && snapshotService.getTurnChanges) {
        try {
          const endSnapshotHash = await snapshotService.track(this.cwd);
          if (endSnapshotHash) {
            const turnChanges = await snapshotService.getTurnChanges(
              this.cwd,
              startSnapshotHash,
              endSnapshotHash,
            );
            if (turnChanges) {
              turnData.turnChanges = turnChanges;
            }
          }
        } catch (e: unknown) {
          this.logger.error(e, 'Failed to compute turn changes');
        }
      }

      if (promptResult.usage) {
        const metrics: AgentUsage = promptResult.usage;
        if (metrics) {
          turnData.usage = metrics;

          const sessionRecord = await this.db.query.sessions.findFirst({
            where: eq(sessions.id, this.sessionId),
          });
          if (sessionRecord) {
            const existingMetrics = jsonCodecs.unknownRecord(sessionRecord.sessionMetrics);

            const currentInput =
              typeof existingMetrics.inputTokens === 'number' ? existingMetrics.inputTokens : 0;
            const currentOutput =
              typeof existingMetrics.outputTokens === 'number' ? existingMetrics.outputTokens : 0;

            const newInput = currentInput + (metrics.inputTokens ?? 0);
            const newOutput = currentOutput + (metrics.outputTokens ?? 0);
            const newTotal = Math.max(0, metrics.totalTokens ?? newInput + newOutput);
            const effectiveLimit =
              metrics.contextLimit && metrics.contextLimit > 0
                ? metrics.contextLimit
                : sessionRecord.contextLimit > 0
                  ? sessionRecord.contextLimit
                  : typeof existingMetrics.contextLimit === 'number' &&
                      existingMetrics.contextLimit > 0
                    ? existingMetrics.contextLimit
                    : 0;
            const newContextLimit =
              effectiveLimit > 0 ? effectiveLimit : sessionRecord.contextLimit;
            const newCost = metrics.cost
              ? sessionRecord.estimatedCost + metrics.cost.amount
              : sessionRecord.estimatedCost;

            const updatedMetrics = {
              ...existingMetrics,
              inputTokens: newInput,
              outputTokens: newOutput,
              totalTokens: newTotal,
              ...(newContextLimit > 0 ? { contextLimit: newContextLimit } : {}),
              estimatedCost: newCost,
              lastTurn: metrics,
            };

            const sessionUpdate: Record<string, unknown> = {
              totalTokens: newTotal,
              estimatedCost: newCost,
              sessionMetrics: JSON.stringify(updatedMetrics),
              updatedAt: new Date(),
            };
            if (newContextLimit > 0) {
              sessionUpdate.contextLimit = newContextLimit;
            }

            await this.db
              .update(sessions)
              .set(sessionUpdate)
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

  resolvePermission(permissionId: string, response: AgentPermissionResponse): void {
    const resolve = this.pendingApprovals.get(permissionId);
    if (resolve) {
      const request = this.pendingRequests.get(permissionId);
      this.pendingRequests.delete(permissionId);

      let finalResponse = response;
      const selectedOption = request?.options?.find(
        (option) => option.optionId === response.optionId,
      );
      const isRejectChoice =
        isDeniedOption(response.optionId) ||
        selectedOption?.kind === 'reject_once' ||
        selectedOption?.kind === 'reject_always' ||
        /^(deny|reject|no)\b/i.test(selectedOption?.label ?? '');
      if (finalResponse.allowed && isRejectChoice) {
        // An explicitly selected rejection must not grant permission, even
        // when the agent uses an opaque option id.
        finalResponse = { allowed: false, optionId: selectedOption?.optionId };
      }
      if (finalResponse.allowed && request) {
        const reqOptions = request.options;
        if (reqOptions && reqOptions.length > 0) {
          const hasOption = reqOptions.some((o) => o.optionId === response.optionId);
          if (!hasOption) {
            const bestOptionId = getBestPermissionOption(reqOptions);
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
        // Agent-native persistent choices may use opaque ids. Honor their
        // advertised kind when deciding whether to retain a grant.
        const isPersistentChoice =
          isPersistentPermissionOption(finalResponse.optionId) ||
          selectedOption?.kind === 'allow_always';
        if (isPersistentChoice && request) {
          this.permissionEngine.grantForDomainRequest(request);
        } else {
          this.permissionEngine.applyOutcome({
            option_id: finalResponse.optionId ?? 'allow_once',
            option_kind: isPersistentChoice ? 'allow_always' : 'allow_once',
            params: (response as { params?: Record<string, unknown> }).params,
          });
        }
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

    void this.runtimeHandle.close();
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
    if (!this.isStopped) {
      this.isStopped = true;
      this.pendingApprovals.clear();
      this.pendingRequests.clear();
      await this.runtimeHandle.close();
    }
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
    this.logger.error(error, `Error in managed session ${this.sessionId}`);
    this.stopKind = 'error';
    await this.flushAll();
    await this.projector.finalizeInFlightToolCalls();
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

  public async handleDomainEvent(event: AgentUpdate): Promise<void> {
    try {
      await this.projector.handleDomainEvent(event);
    } catch (error) {
      await this.handleError(error).catch((e: unknown) => {
        this.logger.error(e, 'Failed to handle error in handleDomainEvent');
      });
    }
  }

  public async handleRequestPermission(
    request: AgentPermissionRequest,
  ): Promise<AgentPermissionResponse> {
    try {
      const permissionId = request.toolCall.toolCallId ?? Math.random().toString(36).substring(7);
      const parentId = this.projector.getCurrentParentEventId();

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
            const overridesMap = jsonCodecs.toolPermissions(mcpServer.toolPermissions);
            override = overridesMap[shortToolName];
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
          const bestOptionId = getBestPermissionOption(reqOptions);
          return {
            allowed: true,
            optionId: bestOptionId,
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

      const approvalPromise = new Promise<AgentPermissionResponse>((resolve) => {
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
