import type {
  WorkspaceAllocationInput,
  WorkspaceBinding,
  WorkspaceApplyOptions,
} from './workspace.js';
import type {
  RepositoryReview,
  RevisionReference,
  SourceRepositoryInfo,
  ReviewFile,
} from '@agentctl/shared';
import { RepositoryError } from './errors.js';
import { RevisionReferenceCodec } from './identity.js';
import type {
  BackendWorkspace,
  RepositoryReviewOptions,
  ChangeComparison,
  RepositoryRestore,
} from './types.js';

export class SourceRepository {
  readonly info: SourceRepositoryInfo;
  private readonly recoveries: RevisionReferenceCodec;
  private readonly references: RevisionReferenceCodec;

  constructor(
    backendId: string,
    private readonly workspace: BackendWorkspace,
  ) {
    this.info = {
      ...workspace.identity,
      backendId,
      capabilities: {
        review: !!workspace.review,
        checkpoints: !!workspace.capture,
        comparisons: !!workspace.compare && !!workspace.diff,
        restore: !!workspace.restore,
        isolation: !!workspace.lifecycle,
        integration: !!workspace.integration,
        staging: !!workspace.stageFile,
      },
    };
    this.references = new RevisionReferenceCodec(this.info);
    this.recoveries = new RevisionReferenceCodec(this.info, 'recovery:v1:');
  }

  /** Only an explicitly declared legacy adapter can import pre-boundary persisted selectors. */
  async importRevision(value: string): Promise<RevisionReference> {
    if (value.startsWith('revision:')) {
      this.references.decode(value);
      return value;
    }
    if (!this.workspace.importLegacyRevision)
      throw new RepositoryError(
        'invalid_revision',
        'Legacy revisions are unsupported by this backend',
      );
    return this.references.encode(await this.workspace.importLegacyRevision(value));
  }
  async localLabel(): Promise<string> {
    return this.workspace.localLabel?.() ?? '';
  }
  async allocateWorkspace(input: WorkspaceAllocationInput) {
    if (!this.workspace.lifecycle) return this.unsupported('isolated workspaces');
    const allocation = await this.workspace.lifecycle.allocate(input);
    return allocation
      ? { ...allocation, baseline: this.references.encode(allocation.baseline) }
      : null;
  }
  private async nativeBinding(binding: WorkspaceBinding): Promise<WorkspaceBinding> {
    return {
      ...binding,
      baseline:
        binding.baseline && binding.baseline !== 'none'
          ? this.references.decode(await this.importRevision(binding.baseline))
          : undefined,
    };
  }
  async restoreWorkspace(binding: WorkspaceBinding, allowRecreate: boolean) {
    if (!this.workspace.lifecycle) return this.unsupported('workspace restoration');
    return this.workspace.lifecycle.restore(await this.nativeBinding(binding), allowRecreate);
  }
  async retireWorkspace(binding: WorkspaceBinding, keepChanges = false) {
    if (!this.workspace.lifecycle) return this.unsupported('workspace retirement');
    return this.workspace.lifecycle.retire(await this.nativeBinding(binding), keepChanges);
  }
  async syncWorkspaces(activeIds: string[], knownIds: string[]) {
    await this.workspace.lifecycle?.sync(activeIds, knownIds);
  }
  async previewIntegration(binding: WorkspaceBinding, target: string) {
    if (!this.workspace.integration) return this.unsupported('workspace integration');
    return this.workspace.integration.preview(await this.nativeBinding(binding), target);
  }
  async applyWorkspace(binding: WorkspaceBinding, options: WorkspaceApplyOptions) {
    if (!this.workspace.integration) return this.unsupported('workspace integration');
    return this.workspace.integration.apply(await this.nativeBinding(binding), options);
  }
  async discardWorkspace(binding: WorkspaceBinding): Promise<string> {
    if (!this.workspace.integration) return this.unsupported('workspace discard');
    const recovery = await this.workspace.integration.discard(await this.nativeBinding(binding));
    return this.recoveries.encode(recovery);
  }
  async undoWorkspaceDiscard(binding: WorkspaceBinding, recovery: string) {
    if (!this.workspace.integration) return this.unsupported('discard recovery');
    const native = recovery.startsWith('recovery:')
      ? this.recoveries.decode(recovery)
      : this.workspace.importLegacyRecovery?.(recovery);
    if (native === undefined)
      throw new RepositoryError('invalid_revision', 'Unsupported recovery reference');
    return this.workspace.integration.undoDiscard(await this.nativeBinding(binding), native);
  }
  async forgetRecovery(sessionId: string) {
    await this.workspace.integration?.forgetRecovery(sessionId);
  }
  async cleanup() {
    await this.workspace.cleanup?.();
  }
  async stageFile(filePath: string) {
    if (!this.workspace.stageFile) return this.unsupported('staging');
    return this.workspace.stageFile(filePath);
  }
  async revertFiles(revision: RevisionReference, paths: string[]) {
    if (!this.workspace.revertFiles) return this.unsupported('selected file restoration');
    return this.workspace.revertFiles(this.references.decode(revision), paths);
  }

  get legacyProjectMetadata() {
    return this.workspace.legacyProjectMetadata;
  }

  private unsupported(operation: string): never {
    throw new RepositoryError('unsupported', `This workspace does not support ${operation}`);
  }

  /** Import a persisted/backend selector once; consumers retain only the opaque result. */
  async resolveRevision(selector: string): Promise<RevisionReference> {
    if (!this.workspace.resolveRevision) return this.unsupported('revision lookup');
    return this.references.encode(await this.workspace.resolveRevision(selector));
  }

  async capture(): Promise<RevisionReference> {
    if (!this.workspace.capture) return this.unsupported('checkpoints');
    return this.references.encode(await this.workspace.capture());
  }

  async review(
    baseline?: RevisionReference,
    options: RepositoryReviewOptions = {},
  ): Promise<RepositoryReview> {
    const nativeBaseline = baseline === undefined ? undefined : this.references.decode(baseline);
    if (!this.workspace.review) return { repository: this.info, files: [] };
    const result = await this.workspace.review(nativeBaseline, options);
    return {
      repository: this.info,
      files: result.files,
      ...(result.capture
        ? {
            capture: {
              current: this.references.encode(result.capture.current),
              working: this.references.encode(result.capture.working),
              baseline: this.references.encode(result.capture.baseline),
            },
          }
        : {}),
    };
  }

  async compare(from: RevisionReference, to: RevisionReference): Promise<ChangeComparison> {
    if (!this.workspace.compare) return this.unsupported('revision comparisons');
    return this.workspace.compare(this.references.decode(from), this.references.decode(to));
  }

  async diff(
    from: RevisionReference,
    to: RevisionReference,
    filePath?: string,
  ): Promise<ReviewFile[]> {
    if (!this.workspace.diff) return this.unsupported('revision comparisons');
    return this.workspace.diff(this.references.decode(from), this.references.decode(to), filePath);
  }

  async restore(revision: RevisionReference): Promise<RepositoryRestore> {
    if (!this.workspace.restore) return this.unsupported('restore');
    const result = await this.workspace.restore(this.references.decode(revision));
    return { backup: this.references.encode(result.backup), restoredFiles: result.restoredFiles };
  }
}
