import { createHash } from 'node:crypto';
import type { ApprovalMode } from '@agentctl/shared';
import type { AgentPermissionRequest } from '../agent/types.js';
import { getBestPermissionOption } from './permission-options.js';
import { resolveAllowedPath } from './path-security.js';

export type PermissionDisposition = 'allow' | 'ask' | 'deny';
export interface PermissionPolicy {
  mode: ApprovalMode;
  cwd: string;
  additionalDirectories?: string[];
  toolPolicy?: 'always_prompt' | 'auto_approve' | 'deny';
}

const MUTATIONS = new Set(['edit', 'delete', 'move']);

function sortedJson(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => {
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      return Object.fromEntries(
        Object.entries(item).sort(([left], [right]) => left.localeCompare(right)),
      );
    }
    return item;
  });
}

function canonicalPaths(
  request: AgentPermissionRequest,
  policy: PermissionPolicy,
): string[] | null {
  const locations = request.toolCall.locations;
  if (!locations?.length || locations.some((location) => !location.path)) return null;
  try {
    return [
      ...new Set(
        locations.map((location) =>
          resolveAllowedPath(location.path!, policy.cwd, policy.additionalDirectories, true),
        ),
      ),
    ].sort();
  } catch {
    return null;
  }
}

/** An exact action identity, never a directory wildcard or command prefix. */
function actionKey(request: AgentPermissionRequest, policy: PermissionPolicy): string | null {
  const call = request.toolCall;
  const args = { ...call.arguments };
  const kind = call.kind ?? 'other';
  const raw = call.rawInput;
  const rawDetails =
    raw == null
      ? {}
      : typeof raw !== 'object' || Array.isArray(raw)
        ? { rawInput: raw }
        : 'arguments' in raw
          ? Object.fromEntries(
              Object.entries(raw).filter(([field]) => field !== 'name' && field !== 'arguments'),
            )
          : {};
  let identity: unknown;
  if (MUTATIONS.has(kind)) {
    const paths = canonicalPaths(request, policy);
    if (!paths) return null;
    // Normalize the path aliases already resolved by the structured locations.
    for (const field of ['path', 'filePath', 'TargetFile', 'AbsolutePath']) {
      if (typeof args[field] === 'string') {
        try {
          args[field] = resolveAllowedPath(
            args[field],
            policy.cwd,
            policy.additionalDirectories,
            true,
          );
        } catch {
          return null;
        }
      }
    }
    identity = { kind, paths, args, rawDetails };
  } else if (kind === 'execute') {
    if (
      (typeof args.command !== 'string' || !args.command) &&
      !(typeof args.terminalId === 'string' && typeof args.input === 'string')
    )
      return null;
    try {
      args.cwd = resolveAllowedPath(
        typeof args.cwd === 'string' ? args.cwd : policy.cwd,
        policy.cwd,
        policy.additionalDirectories,
      );
    } catch {
      return null;
    }
    args.args ??= [];
    args.env ??= {};
    identity = { kind, args, rawDetails };
  } else {
    // Future subjects and unfamiliar tools stay opaque and cannot authorize
    // client execution. An explicit persistent choice can match this exact request.
    if (!request.subject && !Object.keys(args).length) return null;
    identity = { kind, name: call.name, args, subject: request.subject, rawInput: call.rawInput };
  }
  return createHash('sha256')
    .update(sortedJson({ subagentId: request.subagentId ?? null, action: identity }))
    .digest('hex');
}

export class PermissionEngine {
  private grants = new Map<string, 'allow' | 'deny'>();
  private clientReceipts = new Map<string, number>();

  evaluate(request: AgentPermissionRequest, policy: PermissionPolicy): PermissionDisposition {
    if (policy.toolPolicy === 'deny') return 'deny';
    const key = actionKey(request, policy);
    const source = request.source ?? 'provider';
    const remembered = key ? this.grants.get(`${source}:${key}`) : undefined;
    if (
      key &&
      ['provider', 'client'].some((origin) => this.grants.get(`${origin}:${key}`) === 'deny')
    )
      return 'deny';
    let disposition: PermissionDisposition = 'ask';
    if (source === 'client' && key && this.clientReceipts.has(key)) {
      const remaining = this.clientReceipts.get(key)! - 1;
      if (remaining > 0) this.clientReceipts.set(key, remaining);
      else this.clientReceipts.delete(key);
      disposition = 'allow';
    } else if (policy.toolPolicy === 'always_prompt') {
      disposition = 'ask';
    } else if (remembered === 'allow') {
      disposition = 'allow';
    } else if (policy.mode === 'yolo') {
      disposition = 'allow';
    } else if (policy.mode === 'auto_approve') {
      if (policy.toolPolicy === 'auto_approve') disposition = 'allow';
      else if (MUTATIONS.has(request.toolCall.kind ?? '') && canonicalPaths(request, policy)) {
        disposition = 'allow';
      }
    }
    // Never turn an automatic decision into the provider's persistent choice.
    if (
      disposition === 'allow' &&
      request.options?.length &&
      !getBestPermissionOption(request.options)
    ) {
      return 'ask';
    }
    return disposition;
  }

  recordDecision(
    request: AgentPermissionRequest,
    policy: PermissionPolicy,
    allowed: boolean,
    persistent: boolean,
  ): void {
    const key = actionKey(request, policy);
    if (!key) return;
    const source = request.source ?? 'provider';
    if (!allowed) this.clientReceipts.delete(key);
    if (persistent) {
      this.setBounded(this.grants, `${source}:${key}`, allowed ? 'allow' : 'deny');
    }
    // A provider approval authorizes one matching client operation during this
    // turn. A provider's persistent scope never becomes a blanket client grant.
    if (
      allowed &&
      source === 'provider' &&
      (MUTATIONS.has(request.toolCall.kind ?? '') || request.toolCall.kind === 'execute')
    ) {
      this.setBounded(this.clientReceipts, key, (this.clientReceipts.get(key) ?? 0) + 1);
    }
  }

  clearTurn(): void {
    this.clientReceipts.clear();
  }

  clear(): void {
    this.grants.clear();
    this.clearTurn();
  }

  private setBounded<T>(map: Map<string, T>, key: string, value: T): void {
    if (!map.has(key) && map.size >= 256) map.delete(map.keys().next().value!);
    map.set(key, value);
  }
}
