export class RepositoryError extends Error {
  constructor(
    readonly code: 'unsupported' | 'invalid_revision',
    message: string,
  ) {
    super(message);
    this.name = 'RepositoryError';
  }
}
