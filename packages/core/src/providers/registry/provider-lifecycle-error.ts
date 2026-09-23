export type ProviderLifecycleErrorCode =
  | 'INSTALL_CANCELLED'
  | 'INSTALL_INTERRUPTED'
  | 'DOWNLOAD_FAILED'
  | 'DOWNLOAD_TOO_LARGE'
  | 'CHECKSUM_MISMATCH'
  | 'UNSAFE_ARCHIVE'
  | 'ACTIVATION_FAILED'
  | 'ACP_HANDSHAKE_FAILED'
  | 'AUTH_TIMEOUT';

export class ProviderLifecycleError extends Error {
  constructor(
    readonly code: ProviderLifecycleErrorCode,
    message: string,
    options?: { cause?: unknown; retryable?: boolean },
  ) {
    super(message, { cause: options?.cause });
    this.name = 'ProviderLifecycleError';
    this.retryable = options?.retryable ?? true;
  }

  readonly retryable: boolean;
}

export function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === 'AbortError') ||
    (error instanceof Error &&
      (error.name === 'AbortError' || error.message === 'Install cancelled'))
  );
}
