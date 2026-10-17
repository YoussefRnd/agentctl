export function isExternalUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    return ['http:', 'https:', 'mailto:'].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

export function isRendererNavigation(target: string, current: string): boolean {
  try {
    const next = new URL(target);
    const renderer = new URL(current);
    return (
      next.protocol === renderer.protocol &&
      (next.protocol === 'file:'
        ? next.host === renderer.host && next.pathname === renderer.pathname
        : next.origin === renderer.origin)
    );
  } catch {
    return false;
  }
}
