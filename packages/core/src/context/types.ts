export type ContextItemType = 'file' | 'folder' | 'git' | 'symbol';

export interface ContextItem {
  id: string;
  type: ContextItemType;
  title: string;
  subtitle: string;
  value: string;
  metadata?: Record<string, unknown>;
}

export interface ContextItemReference {
  type: ContextItemType;
  value: string;
  path?: string;
  target?: string;
}

export interface ResolvedContextResult {
  formattedContent: string;
  items: Array<{
    id: string;
    type: ContextItemType;
    title: string;
    size: number;
  }>;
}
