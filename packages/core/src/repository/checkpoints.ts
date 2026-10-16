import type { RepositoryService } from './repository-service.js';

/** Session-facing checkpoint capability. Persisted values are scoped opaque references. */
export class RepositoryCheckpoints {
  constructor(private readonly repositories: Pick<RepositoryService, 'open'>) {}
  async track(path: string): Promise<string | undefined> {
    const repository = await this.repositories.open(path);
    return repository.info.capabilities.checkpoints ? repository.capture() : undefined;
  }
  async getTurnChanges(path: string, from: string, to?: string) {
    const repository = await this.repositories.open(path);
    const baseline = await repository.importRevision(from);
    const target = to ? await repository.importRevision(to) : await repository.capture();
    return repository.compare(baseline, target);
  }
}
