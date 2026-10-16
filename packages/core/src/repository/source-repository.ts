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
      },
    };
    this.references = new RevisionReferenceCodec(this.info);
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
