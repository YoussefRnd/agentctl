import type { SourceRepository } from '../repository/source-repository.js';
import { RevisionReferenceCodec } from '../repository/identity.js';
import { RepositoryError } from '../repository/errors.js';

/** Only legacy Git HTTP adapters export native IDs; session persistence keeps opaque references. */
export async function legacyGitRevision(
  repository: SourceRepository,
  stored: string,
): Promise<string> {
  if (repository.info.backendId !== 'git')
    throw new RepositoryError('unsupported', 'Git review is unavailable for this workspace');
  if (stored === 'none') return stored;
  const reference = await repository.importRevision(stored);
  return new RevisionReferenceCodec(repository.info).decode(reference);
}
