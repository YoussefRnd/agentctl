import { createHash } from 'node:crypto';
import { z } from 'zod';
import {
  revisionReferenceSchema,
  type RevisionReference,
  type SourceRepositoryInfo,
} from '@agentctl/shared';
import { RepositoryError } from './errors.js';

const referencePayload = z.object({
  version: z.literal(1),
  backend: z.string().min(1),
  repository: z.string().min(1),
  scope: z.string(),
  revision: z.string().min(1),
});
const PREFIX = 'revision:v1:';

/** Stable local identities without exposing backend metadata directory paths. */
export function repositoryIdentity(backendId: string, canonicalPath: string): string {
  return createHash('sha256')
    .update(JSON.stringify([backendId, canonicalPath]))
    .digest('hex');
}

/** Encodes immutable revisions and verifies their owning backend, repository, and scope. */
export class RevisionReferenceCodec {
  constructor(
    private readonly identity: Pick<SourceRepositoryInfo, 'backendId' | 'repositoryId' | 'scope'>,
  ) {}

  encode(revision: string): RevisionReference {
    return revisionReferenceSchema.parse(
      PREFIX +
        Buffer.from(
          JSON.stringify({
            version: 1,
            backend: this.identity.backendId,
            repository: this.identity.repositoryId,
            scope: this.identity.scope,
            revision,
          }),
        ).toString('base64url'),
    );
  }

  decode(reference: RevisionReference): string {
    try {
      revisionReferenceSchema.parse(reference);
      if (!reference.startsWith(PREFIX)) throw new Error();
      const payload = referencePayload.parse(
        JSON.parse(Buffer.from(reference.slice(PREFIX.length), 'base64url').toString('utf8')),
      );
      if (
        payload.backend !== this.identity.backendId ||
        payload.repository !== this.identity.repositoryId ||
        payload.scope !== this.identity.scope
      )
        throw new Error();
      return payload.revision;
    } catch {
      throw new RepositoryError(
        'invalid_revision',
        'Revision does not belong to this repository and scope',
      );
    }
  }
}
