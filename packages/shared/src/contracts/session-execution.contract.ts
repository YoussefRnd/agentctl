import { z } from 'zod';
import { sessionExecutionSchema } from '../schemas/session-execution.js';
import { emptyBodySchema } from './contract-common.js';
export const sessionExecutionContract = {
  resumeSessionQueue: {
    method: 'POST',
    path: '/api/sessions/:id/queue/resume',
    pathParams: z.object({ id: z.uuid() }),
    body: emptyBodySchema,
    responses: {
      200: z.object({ success: z.literal(true) }),
      409: z.object({ message: z.string() }),
    },
    summary: 'Resume safely queued messages after a failure',
  },
  getSessionExecution: {
    method: 'GET',
    path: '/api/sessions/:id/execution',
    pathParams: z.object({ id: z.uuid() }),
    responses: { 200: sessionExecutionSchema },
    summary: 'Get execution state and accepted message queue',
  },
  changeQueuedMessage: {
    method: 'POST',
    path: '/api/sessions/:id/queue/:commandId',
    pathParams: z.object({ id: z.uuid(), commandId: z.string() }),
    body: z.discriminatedUnion('action', [
      z.object({ action: z.enum(['cancel', 'up', 'down']) }),
      z.object({ action: z.literal('edit'), input: z.string().trim().min(1) }),
    ]),
    responses: {
      200: z.object({ success: z.literal(true) }),
      409: z.object({ message: z.string() }),
    },
    summary: 'Edit, cancel, or reorder a message before dispatch',
  },
  cancelSession: {
    method: 'POST',
    path: '/api/sessions/:id/cancel',
    pathParams: z.object({
      id: z.uuid(),
    }),
    body: emptyBodySchema,
    responses: {
      200: z.object({ success: z.boolean() }),
    },
    summary: 'Cancel session run',
  },
  approveEvent: {
    method: 'POST',
    path: '/api/sessions/:id/approve',
    pathParams: z.object({
      id: z.uuid(),
    }),
    body: z.object({
      eventId: z.number(),
      optionId: z.string().optional(),
    }),
    responses: {
      200: z.object({ success: z.boolean() }),
    },
    summary: 'Approve pending session event',
  },
  denyEvent: {
    method: 'POST',
    path: '/api/sessions/:id/deny',
    pathParams: z.object({
      id: z.uuid(),
    }),
    body: z.object({
      eventId: z.number(),
    }),
    responses: {
      200: z.object({ success: z.boolean() }),
    },
    summary: 'Deny pending session event',
  },
  sendInput: {
    method: 'POST',
    path: '/api/sessions/:id/input',
    pathParams: z.object({
      id: z.uuid(),
    }),
    body: z.object({
      input: z.string(),
      clientMessageId: z.uuid().optional(),
      attachmentIds: z.array(z.string()).optional(),
    }),
    responses: {
      200: z.object({ success: z.literal(true), eventId: z.number() }),
      409: z.object({ success: z.literal(false), message: z.string() }),
    },
    summary: 'Send user input to session',
  },
} as const;
