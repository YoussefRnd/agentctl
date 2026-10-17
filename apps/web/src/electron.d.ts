import type { ElectronAPI } from '@agentctl/shared';
export type { UpdateState } from '@agentctl/shared';

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}
