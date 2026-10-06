/** ACP permission tool calls can be partial updates referencing an earlier report. */
export class PermissionMetadataCache {
  private calls = new Map<string, Record<string, unknown>>();

  remember(value: unknown): void {
    if (
      !value ||
      typeof value !== 'object' ||
      !('toolCallId' in value) ||
      typeof value.toolCallId !== 'string'
    )
      return;
    const call = value as { toolCallId: string; [key: string]: unknown };
    const merged = this.merge(call);
    if (!this.calls.has(call.toolCallId) && this.calls.size >= 128) {
      this.calls.delete(this.calls.keys().next().value!);
    }
    this.calls.set(call.toolCallId, merged);
  }

  merge<T extends { toolCallId: string }>(call: T): T {
    return {
      ...this.calls.get(call.toolCallId),
      ...Object.fromEntries(Object.entries(call).filter(([, value]) => value !== undefined)),
    } as T;
  }
}
