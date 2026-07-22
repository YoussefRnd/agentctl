import type {
  PermissionOption,
  PermissionOptionChoice,
  PermissionOptions,
  PermissionPattern,
  SelectedPermissionOutcome,
} from '@agentctl/shared';

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

export class PermissionPatternManager {
  private grantedPatterns = new Map<string, GrantedPatternData>();

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

  exportPatterns(): ExportedPermissions {
    const active: GrantedPatternData[] = [];
    const now = Date.now();
    for (const [, data] of this.grantedPatterns.entries()) {
      if (data.expiresAt && now > data.expiresAt) continue;
      if (data.usesRemaining !== undefined && data.usesRemaining <= 0) continue;
      active.push({ ...data });
    }
    return { grantedPatterns: active };
  }

  importPatterns(data: ExportedPermissions): void {
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

    return targets.every((target) => {
      for (const [pattern, data] of this.grantedPatterns.entries()) {
        if (data.expiresAt && now > data.expiresAt) {
          this.grantedPatterns.delete(pattern);
          continue;
        }
        if (data.usesRemaining !== undefined && data.usesRemaining <= 0) {
          this.grantedPatterns.delete(pattern);
          continue;
        }

        if (this.matchPattern(pattern, toolName, target)) {
          if (data.usesRemaining !== undefined) {
            data.usesRemaining -= 1;
            if (data.usesRemaining <= 0) {
              this.grantedPatterns.delete(pattern);
            }
          }
          return true;
        }
      }
      return false;
    });
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
    if (
      (outcome.option_kind === 'allow_always' || outcome.option_id === 'allow_always') &&
      outcome.params?.patterns
    ) {
      for (const p of outcome.params.patterns) {
        this.grantPattern(p);
      }
    }
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
