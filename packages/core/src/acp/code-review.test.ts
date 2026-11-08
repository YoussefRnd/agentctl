import { collectReviewContext } from '../repository/review-context.js';
import * as v1 from '@agentclientprotocol/sdk';
import * as v2 from '@agentclientprotocol/sdk/experimental/v2';
import { EventEmitter } from 'node:events';
import type { ChildProcess, spawn } from 'node:child_process';
import { expect, it, vi } from 'vite-plus/test';
import { EMPTY_AGENT_FEATURES, type ReviewFile } from '@agentctl/shared';
import { buildReviewHandoffPrompt } from '../agent/review-handoff.js';
import { reviewCapturedChanges, buildCodeReviewPrompt } from '../agent/code-review.js';
import { noopLogger } from '../logger.js';
import { AcpAgentDriver } from './driver.js';
import { AcpV1AgentDriver } from './v1/driver.js';
import { AcpV2AgentDriver } from './v2/driver.js';
import type { AgentStreamTransport } from './transport/acp-process-lifecycle.js';

it.each(
  (['v1', 'v2'] as const).flatMap((version) =>
    (['review', 'ask', 'fix'] as const).map((mode) => ({ version, mode })),
  ),
)(
  'transports $mode through the real $version adapter with only baseline session and text capabilities',
  async ({ version, mode }) => {
    const toAgent = new TransformStream<Uint8Array>();
    const toClient = new TransformStream<Uint8Array>();
    const child = new EventEmitter() as ChildProcess;
    const transport: AgentStreamTransport = {
      child,
      stdin: toAgent.writable,
      stdout: toClient.readable,
      closed: new Promise(() => {}),
      isAlive: true,
      kill: vi.fn(),
    };
    const spawnImpl = (() => child) as typeof spawn;
    const created = vi.fn();
    const received = vi.fn();
    const output = {
      summary: 'No concrete bugs found in the supplied diff. Tests were not run.',
      findings: [],
      walkthrough: [
        {
          title: 'Understand the change',
          summary: 'The captured implementation changes its result.',
          excerpts: [{ path: 'example.ts', side: 'new', line: 1 }],
          files: [],
        },
      ],
    };
    let close: () => void;
    if (version === 'v1') {
      const peer = v1.agent({ name: 'generic-review-peer' });
      peer.onRequest(v1.methods.agent.initialize, () => ({
        protocolVersion: 1,
        agentCapabilities: {},
      }));
      peer.onRequest(v1.methods.agent.session.new, ({ params }) => {
        created(params);
        return { sessionId: 'review' };
      });
      peer.onRequest(v1.methods.agent.session.prompt, async ({ params, client }) => {
        received(params);
        await client.notify(v1.methods.client.session.update, {
          sessionId: params.sessionId,
          update: {
            sessionUpdate: 'agent_message_chunk',
            content: { type: 'text', text: JSON.stringify(output) },
          },
        });
        return { stopReason: 'end_turn' };
      });
      const connection = peer.connect(v1.ndJsonStream(toClient.writable, toAgent.readable));
      close = () => connection.close();
    } else {
      const peer = v2.agent({ name: 'generic-review-peer' });
      peer.onRequest(v2.methods.agent.initialize, () => ({
        protocolVersion: v2.PROTOCOL_VERSION,
        info: { name: 'generic-review-peer', version: '1' },
        capabilities: { session: {} },
      }));
      peer.onRequest(v2.methods.agent.session.new, ({ params }) => {
        created(params);
        return { sessionId: 'review' };
      });
      peer.onRequest(v2.methods.agent.session.prompt, async ({ params, client }) => {
        received(params);
        await client.notify(v2.methods.client.session.update, {
          sessionId: params.sessionId,
          update: {
            sessionUpdate: 'agent_message_chunk',
            messageId: 'result',
            content: { type: 'text', text: JSON.stringify(output) },
          },
        });
        await client.notify(v2.methods.client.session.update, {
          sessionId: params.sessionId,
          update: { sessionUpdate: 'state_update', state: 'idle', stopReason: 'end_turn' },
        });
        return { messageId: 'result' };
      });
      const connection = peer.connect(v2.ndJsonStream(toClient.writable, toAgent.readable));
      close = () => connection.close();
    }
    const files: ReviewFile[] = [
      { path: 'example.ts', state: 'modified', diff: '@@ -1 +1 @@\n-old\n+new' },
    ];
    const context = await collectReviewContext({
      current: {
        listFiles: async () => ({
          files: [
            { path: 'example.ts', kind: 'file', size: 40 },
            { path: 'example.test.ts', kind: 'file', size: 60 },
          ],
          truncated: false,
        }),
        readFile: async (path) => ({
          status: 'text',
          text: path.endsWith('.test.ts')
            ? 'expect(example()).toEqual("CAPTURED_TEST_CONTEXT");'
            : 'export function example() { return "new"; }',
        }),
        search: async () => ({ paths: ['example.test.ts'], truncated: false }),
      },
      before: null,
      files,
    });
    try {
      const driver = new AcpAgentDriver(
        new AcpV1AgentDriver(spawnImpl, noopLogger, () => transport),
        new AcpV2AgentDriver(spawnImpl, noopLogger, () => transport),
      );
      expect(
        await reviewCapturedChanges(
          driver,
          { command: 'any-provider', args: [], env: { AGENTCTL_ACP_PROTOCOL: version } },
          { features: EMPTY_AGENT_FEATURES },
          mode !== 'review'
            ? buildReviewHandoffPrompt(
                mode,
                {
                  finding: { path: 'example.ts', body: 'ACP_HANDOFF_SCENARIO' },
                  history: null,
                  checks: [],
                  sources: {},
                },
                'Inspect current code first.',
              ).prompt
            : buildCodeReviewPrompt(
                files,
                'Update example',
                '',
                context,
                60000,
                [
                  {
                    checkId: '11111111-1111-4111-8111-111111111111',
                    name: 'Regression',
                    command: 'pnpm test',
                    status: 'failed',
                    exitCode: 1,
                    startedAt: 10,
                    finishedAt: 20,
                    stdout: 'APP_RECORDED_FAILURE',
                    stderr: '',
                    outputTruncated: false,
                  },
                ],
                [
                  {
                    reviewId: '11111111-1111-4111-8111-111111111111',
                    findingId: '22222222-2222-4222-8222-222222222222',
                    path: 'example.ts',
                    line: 1,
                    title: 'Prior issue',
                    body: 'Earlier failure scenario',
                    status: 'dismissed',
                    resolution: 'PRIOR_DECISION_ACROSS_ACP',
                    verification: {
                      state: 'suspected',
                      checkId: null,
                      reason: null,
                      confirmedAt: null,
                    },
                    comparison: 'changed',
                    fingerprint: null,
                    lastDecision: null,
                    lastEvidence: null,
                  },
                ],
              ),
          files,
          new AbortController().signal,
        ),
      ).toEqual(output);
      if (mode === 'review') {
        expect(JSON.stringify(received.mock.calls)).toContain('CAPTURED_TEST_CONTEXT');
        expect(JSON.stringify(received.mock.calls)).toContain('contextFiles');
        expect(JSON.stringify(received.mock.calls)).toContain('verificationEvidence');
        expect(JSON.stringify(received.mock.calls)).toContain('APP_RECORDED_FAILURE');
        expect(JSON.stringify(received.mock.calls)).toContain('PRIOR_DECISION_ACROSS_ACP');
        expect(JSON.stringify(received.mock.calls)).toContain('previousFindings');
      } else {
        expect(JSON.stringify(received.mock.calls)).toContain('ACP_HANDOFF_SCENARIO');
        expect(JSON.stringify(received.mock.calls)).toContain(
          mode === 'ask' ? 'do not edit files' : 'fix only if the issue is still valid',
        );
      }
      expect(created).toHaveBeenCalledWith(
        expect.objectContaining({
          cwd: expect.stringContaining('agentctl-review-'),
          mcpServers: [],
        }),
      );
    } finally {
      close();
    }
  },
);
