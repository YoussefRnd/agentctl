import { and, eq, inArray } from 'drizzle-orm';
import { sessions, mcpServers, sessionTurnAttempts } from '../../db/schema.js';
import type { DbClient } from '../../db/index.js';
import { jsonCodecs } from '../../db/json-codecs.js';
import type { AgentPermissionRequest, AgentPermissionResponse } from '../../agent/types.js';
import type { SessionEventRepositoryLike, SessionStatusTransitioner } from '../contracts.js';
import { PermissionEngine, type PermissionPolicy } from '../../security/permission-engine.js';
import {
  getBestPermissionOption,
  isPersistentPermissionOption,
} from '../../security/permission-options.js';
import { RequestCancellation } from './request-cancellation.js';

interface PermissionRuntimeState {
  isStopped(): boolean;
  activeAttemptId(): string | undefined;
  parentEventId(subagentId?: string): number | null;
  closed: Promise<void>;
  onError(error: unknown): Promise<void>;
}

/** Coordinates provider permission requests, user choices and local execution grants. */
export class SessionPermissionController {
  readonly engine = new PermissionEngine();
  epoch = 0;
  private pendingApprovals = new Map<string, (response: AgentPermissionResponse) => void>();
  private pendingRequests = new Map<string, AgentPermissionRequest>();

  constructor(
    private sessionId: string,
    private db: DbClient,
    private eventRepository: SessionEventRepositoryLike,
    private cwd: string,
    private deps: PermissionRuntimeState,
    private runtimeRegistry?: SessionStatusTransitioner,
  ) {}

  clearPending(): void {
    this.epoch += 1;
    this.engine.clearTurn();
    for (const [, resolve] of this.pendingApprovals.entries()) {
      resolve({ allowed: false, cancelled: true });
    }
    this.pendingApprovals.clear();
    this.pendingRequests.clear();
  }

  resolvePermission(permissionId: string, response: AgentPermissionResponse): void {
    const resolve = this.pendingApprovals.get(permissionId);
    if (!resolve) return;
    const request = this.pendingRequests.get(permissionId);
    const selected = request?.options?.find((option) => option.optionId === response.optionId);
    let result = response;
    if (response.optionId && !selected) {
      // An invalid/stale choice must never fall back to a positive option.
      result = { allowed: false, cancelled: true };
    } else if (selected) {
      const rejected =
        selected.kind === 'reject_once' ||
        selected.kind === 'reject_always' ||
        (!selected.kind && /^(deny|reject|no)(?:\b|[_-])/i.test(selected.optionId));
      result =
        !response.allowed && !rejected
          ? { allowed: false, optionId: getBestPermissionOption(request?.options, 'reject') }
          : { allowed: response.allowed && !rejected, optionId: selected.optionId };
    } else if (response.allowed && request?.options?.length) {
      const optionId = getBestPermissionOption(request.options);
      result = optionId ? { allowed: true, optionId } : { allowed: false, cancelled: true };
    }
    resolve(result);
    this.pendingApprovals.delete(permissionId);
  }

  private async permissionPolicy(request: AgentPermissionRequest): Promise<PermissionPolicy> {
    const row = await this.db.query.sessions.findFirst({ where: eq(sessions.id, this.sessionId) });
    const policy: PermissionPolicy = { mode: row?.approvalMode ?? 'review', cwd: this.cwd };
    const separator = request.toolCall.name.indexOf('__');
    if (separator < 1) return policy;
    const serverId = request.toolCall.name.slice(0, separator);
    const toolName = request.toolCall.name.slice(separator + 2);
    const server = await this.db.query.mcpServers.findFirst({ where: eq(mcpServers.id, serverId) });
    if (!server) return policy;
    const override = jsonCodecs.toolPermissions(server.toolPermissions)[toolName];
    policy.toolPolicy = !server.enabled
      ? 'deny'
      : (override ??
        (server.approvalPolicy === 'deny_all'
          ? 'deny'
          : server.approvalPolicy === 'auto_approve_all'
            ? 'auto_approve'
            : 'always_prompt'));
    return policy;
  }

  public async handleRequestPermission(
    request: AgentPermissionRequest,
    signal?: AbortSignal,
  ): Promise<AgentPermissionResponse> {
    const epoch = this.epoch;
    const cancelled = (): AgentPermissionResponse => ({ allowed: false, cancelled: true });
    if (this.deps.isStopped() || signal?.aborted) return cancelled();
    const cancellation = new RequestCancellation(signal);
    try {
      const policy = await this.permissionPolicy(request);
      if (this.deps.isStopped() || epoch !== this.epoch || cancellation.aborted) return cancelled();
      const disposition = this.engine.evaluate(request, policy);
      const parentId = this.deps.parentEventId(request.subagentId);
      const eventId = await this.eventRepository.append(
        this.sessionId,
        'approval_request',
        {
          name: 'request_permission',
          toolCallId: request.toolCall.toolCallId ?? request.permissionId,
          requiresApproval: disposition === 'ask',
          request,
          status:
            disposition === 'ask' ? 'pending' : disposition === 'allow' ? 'approved' : 'denied',
        },
        parentId,
        request.subagentId ? { nativeSessionId: request.subagentId } : undefined,
      );
      if (this.deps.isStopped() || epoch !== this.epoch || cancellation.aborted) {
        await this.updateApprovalEvent(eventId, cancelled());
        return cancelled();
      }
      if (disposition !== 'ask') {
        const allowed = disposition === 'allow';
        const response = {
          allowed,
          optionId: getBestPermissionOption(request.options, allowed ? 'allow' : 'reject'),
        };
        this.engine.recordDecision(request, policy, allowed, false);
        return response;
      }
      const attemptId = this.deps.activeAttemptId();
      if (attemptId)
        await this.db
          .update(sessionTurnAttempts)
          .set({ status: 'waiting' })
          .where(
            and(
              eq(sessionTurnAttempts.id, attemptId),
              inArray(sessionTurnAttempts.status, ['running', 'waiting']),
            ),
          );
      const id = String(eventId);
      const approval = new Promise<AgentPermissionResponse>((resolve) => {
        this.pendingRequests.set(id, request);
        this.pendingApprovals.set(id, resolve);
      });
      try {
        if (this.runtimeRegistry)
          await this.runtimeRegistry.transitionTo(this.sessionId, 'needs_attention');
        else
          await this.db
            .update(sessions)
            .set({ status: 'needs_attention', lastHeartbeat: new Date() })
            .where(eq(sessions.id, this.sessionId));
        let response = await Promise.race([
          approval,
          cancellation.cancelled.then(cancelled),
          this.deps.closed.then(cancelled, cancelled),
        ]);
        if (this.deps.isStopped() || epoch !== this.epoch || cancellation.aborted)
          response = cancelled();
        // Rules may have changed while the user was considering the request.
        const currentPolicy = await this.permissionPolicy(request);
        if (currentPolicy.toolPolicy === 'deny') {
          response = {
            allowed: false,
            optionId: getBestPermissionOption(request.options, 'reject'),
          };
        }
        if (this.deps.isStopped() || epoch !== this.epoch || cancellation.aborted)
          response = cancelled();
        const selected = request.options?.find((option) => option.optionId === response.optionId);
        // Unknown future choice kinds are forwarded faithfully, but do not
        // imply a local execution grant.
        const canRecord =
          !response.allowed ||
          !selected?.kind ||
          selected.kind === 'allow_once' ||
          selected.kind === 'allow_always';
        if (!response.cancelled && canRecord) {
          const persistent =
            selected?.kind === 'allow_always' ||
            selected?.kind === 'reject_always' ||
            (!selected?.kind && isPersistentPermissionOption(response.optionId));
          this.engine.recordDecision(request, currentPolicy, response.allowed, persistent);
        }
        this.pendingRequests.delete(id);
        this.pendingApprovals.delete(id);
        await this.resumeAfterApproval(epoch, cancellation.aborted ? { allowed: false } : response);
        const resumedAttemptId = this.deps.activeAttemptId();
        if (
          resumedAttemptId &&
          !this.pendingRequests.size &&
          (!response.cancelled || cancellation.aborted)
        )
          await this.db
            .update(sessionTurnAttempts)
            .set({ status: 'running' })
            .where(
              and(
                eq(sessionTurnAttempts.id, resumedAttemptId),
                inArray(sessionTurnAttempts.status, ['running', 'waiting']),
              ),
            );
        await this.updateApprovalEvent(eventId, response);
        return this.deps.isStopped() || epoch !== this.epoch || cancellation.aborted
          ? cancelled()
          : response;
      } finally {
        this.pendingRequests.delete(id);
        this.pendingApprovals.delete(id);
      }
    } catch (error) {
      await this.deps.onError(error);
      throw error;
    } finally {
      cancellation.dispose();
    }
  }

  private async resumeAfterApproval(
    epoch: number,
    response: AgentPermissionResponse,
  ): Promise<void> {
    if (
      this.deps.isStopped() ||
      epoch !== this.epoch ||
      response.cancelled ||
      this.pendingRequests.size
    )
      return;
    const row = await this.db.query.sessions.findFirst({ where: eq(sessions.id, this.sessionId) });
    if (
      row?.status !== 'needs_attention' ||
      this.deps.isStopped() ||
      epoch !== this.epoch ||
      this.pendingRequests.size
    )
      return;
    if (this.runtimeRegistry) await this.runtimeRegistry.transitionTo(this.sessionId, 'running');
    else
      await this.db
        .update(sessions)
        .set({ status: 'running', updatedAt: new Date() })
        .where(and(eq(sessions.id, this.sessionId), eq(sessions.status, 'needs_attention')));
  }

  private async updateApprovalEvent(
    eventId: number,
    response: AgentPermissionResponse,
  ): Promise<void> {
    const event = await this.eventRepository.getEvent(eventId);
    if (event)
      await this.eventRepository.update(eventId, {
        ...(event.data as Record<string, unknown>),
        status: response.cancelled ? 'cancelled' : response.allowed ? 'approved' : 'denied',
      });
  }
}
