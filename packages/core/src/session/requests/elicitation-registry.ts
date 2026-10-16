import { getElicitationValidationError } from '@agentctl/shared';
import type { ElicitationItem, ElicitationRequest, ElicitationResponse } from '@agentctl/shared';

export interface PendingElicitation {
  item: ElicitationItem;
  resolve: (response: ElicitationResponse) => void;
}

export class ElicitationRegistry {
  private static readonly retention = 200;
  private static readonly pendingLimit = 100;
  private elicitations = new Map<string, PendingElicitation>();
  private items: ElicitationItem[] = [];

  createElicitation(request: ElicitationRequest): {
    item: ElicitationItem;
    promise: Promise<ElicitationResponse>;
  } {
    if (this.elicitations.has(request.id)) throw new Error('Elicitation is already pending');
    if (this.elicitations.size >= ElicitationRegistry.pendingLimit)
      throw new Error('Too many pending elicitations');
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

    this.items = this.items.filter((previous) => previous.id !== request.id);
    this.items.push(item);
    this.elicitations.set(request.id, { item, resolve: resolveFn });

    return { item, promise };
  }

  respondToElicitation(id: string, response: ElicitationResponse): boolean {
    const pending = this.elicitations.get(id);
    if (pending?.item.status !== 'pending') {
      return false;
    }

    const error = getElicitationValidationError(pending.item.request, response);
    if (error) throw new Error(error);

    pending.item.status =
      response.action === 'cancel'
        ? 'cancelled'
        : response.action === 'decline'
          ? 'declined'
          : 'completed';
    pending.item.response = response;
    pending.resolve(response);
    this.elicitations.delete(id);
    this.prune();
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
    this.prune();
  }

  private prune(): void {
    let settled = this.items.filter((item) => item.status !== 'pending').length;
    this.items = this.items.filter((item) => {
      if (item.status === 'pending' || settled <= ElicitationRegistry.retention) return true;
      settled--;
      return false;
    });
  }
}
