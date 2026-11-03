/** One error-to-copy policy for user feedback. Callers retain contextual copy and toast options. */
export function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() ? error.message : fallback;
}
