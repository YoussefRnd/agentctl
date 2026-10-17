let apiBaseUrl = '';

export function setApiBaseUrl(url: string) {
  apiBaseUrl = url;
}

export function getApiBaseUrl(): string {
  return apiBaseUrl;
}

let desktopCapability: string | null = null;

export function getDesktopCapability(): string | null {
  return desktopCapability;
}

export function setDesktopCapability(value: string): void {
  desktopCapability = value;
}

let unauthorizedHandler: (() => void) | undefined;
/** Application composition supplies navigation policy; transport itself has no window dependency. */
export function setUnauthorizedHandler(handler?: () => void): void {
  unauthorizedHandler = handler;
}
export function notifyUnauthorized(): void {
  unauthorizedHandler?.();
}
