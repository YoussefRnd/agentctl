import type { ContextItem } from '@agentctl/api-client';

/** Page-supplied draft actions. Review never selects a composer store or draft target. */
export interface ReviewComposerActions {
  attachContextToComposer(item: ContextItem): void;
  insertIntoComposer(text: string): void;
}
