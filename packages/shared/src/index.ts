// packages/shared/src/index.ts
export * from './schemas.js';

export type SessionStatus = 'running' | 'needs_attention' | 'idle' | 'error';

export interface ACPEvent {
  type: 'tool_call' | 'text' | 'diff' | 'status' | 'compact';
  data: unknown; // Use unknown for safety
  createdAt: Date;
}
