export interface BrowserSession {
  id: string;
  clientLabel: string;
  ip: string;
  createdAt: number;
  lastActiveAt: number;
  expiresAt: number;
}
