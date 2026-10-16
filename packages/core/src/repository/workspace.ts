/** Workspace metadata is backend-owned; labels/targets are optional display and integration hints. */
export interface WorkspaceBinding {
  sessionId: string;
  path: string;
  isolated: boolean;
  label: string;
  baseline?: string;
  target?: string;
}
export interface WorkspaceAllocation {
  path: string;
  label: string;
  baseline: string;
  target?: string;
}
export interface WorkspaceAllocationInput {
  sessionId: string;
  title: string;
  target?: string;
}
export interface WorkspaceApplyOptions {
  message: string;
  target?: string;
}
export interface WorkspaceIntegrationPreview {
  hasMergeHead: boolean;
  blockedReason: string | null;
}
export interface WorkspaceLifecycle {
  /** Null means isolation is temporarily unavailable (for example an empty history). */
  allocate(input: WorkspaceAllocationInput): Promise<WorkspaceAllocation | null>;
  restore(binding: WorkspaceBinding, allowRecreate: boolean): Promise<void>;
  retire(binding: WorkspaceBinding, keepChanges?: boolean): Promise<void>;
  sync(activeIds: string[], knownIds: string[]): Promise<void>;
}
export interface WorkspaceIntegration {
  preview(binding: WorkspaceBinding, target: string): Promise<WorkspaceIntegrationPreview>;
  apply(binding: WorkspaceBinding, options: WorkspaceApplyOptions): Promise<void>;
  discard(binding: WorkspaceBinding): Promise<string>;
  undoDiscard(binding: WorkspaceBinding, recovery: string): Promise<void>;
  forgetRecovery(sessionId: string): Promise<void>;
}
