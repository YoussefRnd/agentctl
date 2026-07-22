import type { ElicitationItem, ElicitationRequest, ElicitationResponse } from '@agentctl/shared';

export interface PendingElicitation {
  item: ElicitationItem;
  resolve: (response: ElicitationResponse) => void;
}

export class ElicitationStore {
  private elicitations = new Map<string, PendingElicitation>();
  private items: ElicitationItem[] = [];

  createElicitation(request: ElicitationRequest): {
    item: ElicitationItem;
    promise: Promise<ElicitationResponse>;
  } {
    let resolveFn!: (response: ElicitationResponse) => void;
    const promise = new Promise<ElicitationResponse>((resolve) => {
      resolveFn = resolve;
    });

    const item: ElicitationItem = {
      id: request.id,
      request,
      status: 'pending',
      createdAt: new Date().toISOString(),
    };

    this.items.push(item);
    this.elicitations.set(request.id, { item, resolve: resolveFn });

    return { item, promise };
  }

  respondToElicitation(id: string, response: ElicitationResponse): boolean {
    const pending = this.elicitations.get(id);
    if (pending?.item.status !== 'pending') {
      return false;
    }

    pending.item.status = response.action === 'cancel' ? 'cancelled' : 'completed';
    pending.item.response = response;
    pending.resolve(response);
    this.elicitations.delete(id);
    return true;
  }

  cancelElicitation(id: string): boolean {
    return this.respondToElicitation(id, { action: 'cancel' });
  }

  getElicitations(): ElicitationItem[] {
    return [...this.items];
  }

  getElicitation(id: string): ElicitationItem | undefined {
    return this.items.find((item) => item.id === id);
  }

  clear(): void {
    for (const pending of this.elicitations.values()) {
      pending.item.status = 'cancelled';
      pending.resolve({ action: 'cancel' });
    }
    this.elicitations.clear();
  }
}
