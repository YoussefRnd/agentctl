export interface Distribution {
  count: number;
  p50: number;
  p95: number;
  max: number;
}

export interface ClientSetup {
  type: 'setup';
  url: string;
  ids: string[];
}

export interface ClientResult {
  type: 'done';
  acceptMs: Distribution;
  historyMs: Distribution;
  firstOutputMs: Distribution;
  completionMs: Distribution;
  receipts: number[];
}

export type ClientReply = { type: 'ready' } | ClientResult;
