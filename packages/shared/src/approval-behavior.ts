import type { ApprovalMode } from './schemas/session.js';

export const approvalBehaviorOptions: {
  value: ApprovalMode;
  label: string;
  description: string;
}[] = [
  {
    value: 'review',
    label: 'Ask every time',
    description: 'Ask about requests unless you remembered the exact action.',
  },
  {
    value: 'auto_approve',
    label: 'Auto-approve workspace edits',
    description:
      'Approve workspace file changes; ask about commands and unclear actions. Tool rules still apply.',
  },
  {
    value: 'yolo',
    label: 'Auto-approve requests',
    description:
      'Approve incoming requests. Explicit deny and ask rules still apply. Provider restrictions stay in effect.',
  },
];
