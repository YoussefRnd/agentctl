let resolvedBaseUrl = '';

export async function initApiBaseUrl(): Promise<string> {
  // In Electron, ask the main process for the server port
  if (window.electronAPI) {
    const port = await window.electronAPI.getServerPort();
    resolvedBaseUrl = `http://127.0.0.1:${port.toString()}`;
  }
  return resolvedBaseUrl;
}

export function getApiBaseUrl(): string {
  return resolvedBaseUrl;
}
