import type { DriverDiscovery } from './session-schemas.js';

export function getReadyDriverId(drivers: DriverDiscovery[]) {
  return drivers.find((driver) => driver.status === 'ready')?.id ?? 'opencode';
}

export function createTaskSlug(prefix = 'new-session') {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `${prefix}-${timestamp}`;
}
