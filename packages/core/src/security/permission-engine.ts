import type { RequestPermissionRequest, RequestPermissionResponse } from '@agentclientprotocol/sdk';
import type {
  PermissionOption,
  PermissionOptionChoice,
  PermissionOptions,
  PermissionPattern,
  SelectedPermissionOutcome,
} from '@agentctl/shared';
import type { DomainPermissionRequest } from '../acp/types.js';
import {
  getBestPermissionOption,
  isPersistentPermissionOption,
  parsePermissionRequest,
} from '../acp/protocol/permissions.js';

export {
  formatPermissionOutcome,
  getBestPermissionOption,
  isPersistentPermissionOption,
  parsePermissionRequest,
} from '../acp/protocol/permissions.js';

export interface PatternGrantOptions {
  maxUses?: number;
  expiresAt?: number;
}

export interface GrantedPatternData {
  pattern: string;
  usesRemaining?: number;
  expiresAt?: number;
}

export interface ExportedPermissions {
  grantedPatterns: GrantedPatternData[];
}

export interface EvaluationResult {
  autoApproved: boolean;
  response?: RequestPermissionResponse;
  domainRequest?: DomainPermissionRequest;
  uiOptions?: PermissionOptions;
}

export class PermissionEngine {
  private grantedPatterns = new Map<string, GrantedPatternData>();

  constructor(initialPatterns?: GrantedPatternData[]) {
    if (initialPatterns) {
      for (const p of initialPatterns) {
        this.grantPattern(p.pattern, {
          maxUses: p.usesRemaining,
          expiresAt: p.expiresAt,
        });
      }
    }
  }

  grantPattern(pattern: string, options?: PatternGrantOptions): void {
    this.grantedPatterns.set(pattern, {
      pattern,
      usesRemaining: options?.maxUses,
      expiresAt: options?.expiresAt,
    });
  }

  hasPatternGrant(pattern: string): boolean {
    const data = this.grantedPatterns.get(pattern);
    if (!data) return false;
    if (data.expiresAt && Date.now() > data.expiresAt) {
      this.grantedPatterns.delete(pattern);
      return false;
    }
    if (data.usesRemaining !== undefined && data.usesRemaining <= 0) {
      this.grantedPatterns.delete(pattern);
      return false;
    }
    return true;
  }

  exportState(): ExportedPermissions {
    const active: GrantedPatternData[] = [];
    const now = Date.now();
    for (const [, data] of this.grantedPatterns.entries()) {
      if (data.expiresAt && now > data.expiresAt) continue;
      if (data.usesRemaining !== undefined && data.usesRemaining <= 0) continue;
      active.push({ ...data });
    }
    return { grantedPatterns: active };
  }

  importState(data: ExportedPermissions): void {
    if (!Array.isArray(data.grantedPatterns)) return;
    for (const entry of data.grantedPatterns) {
      if (typeof entry.pattern === 'string') {
        this.grantPattern(entry.pattern, {
          maxUses: entry.usesRemaining,
          expiresAt: entry.expiresAt,
        });
      }
    }
  }

  isToolCallApproved(toolName: string, args: Record<string, unknown>): boolean {
    const targets = this.extractTargets(toolName, args);
    if (targets.length === 0) return false;

    const now = Date.now();
    for (const [pattern, data] of this.grantedPatterns) {
      const expired = data.expiresAt !== undefined && now > data.expiresAt;
      const exhausted = data.usesRemaining !== undefined && data.usesRemaining <= 0;
      if (expired || exhausted) this.grantedPatterns.delete(pattern);
    }

    const matchedGrants = new Set<GrantedPatternData>();
    const allTargetsMatch = targets.every((target) => {
      for (const [pattern, data] of this.grantedPatterns) {
        if (this.matchPattern(pattern, toolName, target)) {
          matchedGrants.add(data);
          return true;
        }
      }
      return false;
    });

    if (!allTargetsMatch) return false;

    for (const grant of matchedGrants) {
      if (grant.usesRemaining === undefined) continue;
      grant.usesRemaining -= 1;
      if (grant.usesRemaining <= 0) this.grantedPatterns.delete(grant.pattern);
    }
    return true;
  }

  evaluateRequest(acpRequest: RequestPermissionRequest): EvaluationResult {
    const domainReq = parsePermissionRequest(acpRequest);
    const toolName = domainReq.toolCall.name;
    const toolArgs = domainReq.toolCall.arguments ?? {};

    if (this.isToolCallApproved(toolName, toolArgs)) {
      const bestOptionId = getBestPermissionOption(domainReq.options);
      const response: RequestPermissionResponse = bestOptionId
        ? { outcome: { outcome: 'selected', optionId: bestOptionId } }
        : { outcome: { outcome: 'cancelled' } };

      return {
        autoApproved: true,
        response,
        domainRequest: domainReq,
      };
    }

    const uiOptions = this.buildPermissionOptions(toolName, toolArgs);

    return {
      autoApproved: false,
      domainRequest: domainReq,
      uiOptions,
    };
  }

  buildPermissionOptions(toolName: string, args: Record<string, unknown>): PermissionOptions {
    const targets = this.extractTargets(toolName, args);

    const allowOnce: PermissionOption = {
      option_id: 'allow_once',
      kind: 'allow_once',
      name: 'Allow Once',
      description: 'Allow this tool call execution a single time',
    };

    const allowAlways: PermissionOption = {
      option_id: 'allow_always',
      kind: 'allow_always',
      name: 'Allow Always',
      description: 'Allow this tool for the remainder of the session',
    };

    const rejectOnce: PermissionOption = {
      option_id: 'reject_once',
      kind: 'reject_once',
      name: 'Deny',
      description: 'Reject this tool call execution',
    };

    if (targets.length === 0) {
      return {
        type: 'flat',
        options: [allowOnce, allowAlways, rejectOnce],
      };
    }

    const subPatterns = targets.flatMap((t) => this.generateSubPatterns(toolName, t));
    const choices: PermissionOptionChoice[] = [
      {
        allow: allowOnce,
        deny: rejectOnce,
        sub_patterns: [],
      },
      {
        allow: allowAlways,
        deny: rejectOnce,
        sub_patterns: subPatterns,
      },
    ];

    const patterns: PermissionPattern[] = subPatterns.map((p) => ({
      pattern: p,
      display_name: p,
    }));

    return {
      type: 'dropdown_with_patterns',
      choices,
      patterns,
      tool_name: toolName,
    };
  }

  applyOutcome(outcome: SelectedPermissionOutcome): void {
    if (isPersistentPermissionOption(outcome.option_id) && outcome.params?.patterns) {
      for (const p of outcome.params.patterns) {
        this.grantPattern(p);
      }
    }
  }

  /**
   * Grants the computed sub-patterns for a domain permission request
   * (tool name + extracted targets). Used when the user picks a persistent
   * option on an agent-native option id.
   */
  grantForDomainRequest(domainReq: DomainPermissionRequest): void {
    const toolName = domainReq.toolCall.name;
    const args = domainReq.toolCall.arguments ?? {};
    for (const target of this.extractTargets(toolName, args)) {
      for (const p of this.generateSubPatterns(toolName, target)) {
        this.grantPattern(p);
      }
    }
  }

  resolveOutcome(
    _permissionId: string,
    selectedOptionId: string,
    outcomeParams?: { patterns?: string[] },
  ): RequestPermissionResponse {
    if (isPersistentPermissionOption(selectedOptionId) && outcomeParams?.patterns) {
      for (const p of outcomeParams.patterns) {
        this.grantPattern(p);
      }
    }

    // ACP distinguishes selecting an agent-provided rejection option from
    // dismissing the permission prompt. Every explicit option choice is
    // returned as `selected`; only dismissal maps to `cancelled`.
    return {
      outcome: { outcome: 'selected', optionId: selectedOptionId },
    };
  }

  private extractTargets(toolName: string, args: Record<string, unknown>): string[] {
    const targets: string[] = [];
    if (typeof args.path === 'string') targets.push(args.path);
    if (typeof args.filePath === 'string') targets.push(args.filePath);
    if (typeof args.command === 'string') targets.push(args.command);
    if (typeof args.cmd === 'string') targets.push(args.cmd);
    return targets;
  }

  private generateSubPatterns(toolName: string, target: string): string[] {
    const patterns: string[] = [`${toolName}:${target}`];
    if (target.includes('/')) {
      const parts = target.split('/');
      if (parts.length > 2) {
        const dir = parts.slice(0, parts.length - 1).join('/');
        patterns.push(`${toolName}:${dir}/*`);
      }
    }
    if (target.includes(' ')) {
      const firstWord = target.split(' ')[0];
      if (firstWord) {
        patterns.push(`${toolName}:${firstWord} *`);
      }
    }
    return patterns;
  }

  private matchPattern(pattern: string, toolName: string, target: string): boolean {
    const fullTarget = `${toolName}:${target}`;
    if (pattern === fullTarget) return true;

    if (pattern.includes('*')) {
      const regexStr =
        '^' +
        pattern
          .split(/(\*\*|\*)/)
          .map((part) => {
            if (part === '**') return '.*';
            if (part === '*') return '.*';
            return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          })
          .join('') +
        '$';
      try {
        const regex = new RegExp(regexStr);
        return regex.test(fullTarget);
      } catch {
        if (pattern.endsWith('*')) {
          const prefix = pattern.slice(0, -1);
          return fullTarget.startsWith(prefix);
        }
      }
    }

    return false;
  }
}
