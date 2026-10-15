import { agent, methods, ndJsonStream, RequestError } from '@agentclientprotocol/sdk';
import { Readable, Writable } from 'node:stream';

// Deterministic local peer for validating the opt-in smoke runner without a model service.
const sessions = new Map();
let nextId = 0;
const options = () => [{ id: 'trace', name: 'Trace', type: 'boolean', currentValue: false }];
const session = (id) => {
  const value = sessions.get(id);
  if (!value) throw RequestError.invalidParams(undefined, 'Unknown fixture session');
  return value;
};
const create = (cwd) => {
  const id = `fixture-${++nextId}`;
  sessions.set(id, { cwd });
  return { sessionId: id, configOptions: options() };
};
const app = agent({ name: 'local-smoke-peer' })
  .onRequest(methods.agent.initialize, () => ({
    protocolVersion: 1,
    agentInfo: { name: 'local-smoke-peer', version: '1.0.0' },
    agentCapabilities: {
      sessionCapabilities: { resume: {}, fork: {}, close: {}, list: {}, delete: {} },
    },
  }))
  .onRequest(methods.agent.session.new, ({ params }) => create(params.cwd))
  .onRequest(methods.agent.session.resume, ({ params }) => {
    session(params.sessionId);
    return { configOptions: options() };
  })
  .onRequest(methods.agent.session.fork, ({ params }) => {
    session(params.sessionId);
    return create(params.cwd);
  })
  .onRequest(methods.agent.session.close, () => ({}))
  .onRequest(methods.agent.session.delete, ({ params }) => {
    sessions.delete(params.sessionId);
    return {};
  })
  .onRequest(methods.agent.session.list, () => ({
    sessions: [...sessions].map(([sessionId, value]) => ({ sessionId, cwd: value.cwd })),
  }))
  .onRequest(methods.agent.session.setConfigOption, ({ params }) => ({
    configOptions: options().map((option) => ({ ...option, currentValue: params.value })),
  }))
  .onRequest(methods.agent.session.prompt, async ({ params, client }) => {
    const active = session(params.sessionId);
    active.pending = Promise.withResolvers();
    active.cancelled = false;
    if (process.argv.includes('--gateway'))
      await client.request('_agentctl.dev/mcp/test__echo', {
        sessionId: params.sessionId,
        text: 'example',
      });
    await client.notify(methods.client.session.update, {
      sessionId: params.sessionId,
      update: {
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: 'ACP smoke passed' },
      },
    });
    const timer = setTimeout(() => active.pending.resolve(), 40);
    try {
      await active.pending.promise;
    } finally {
      clearTimeout(timer);
      active.pending = undefined;
    }
    return { stopReason: active.cancelled ? 'cancelled' : 'end_turn' };
  })
  .onNotification(methods.agent.session.cancel, ({ params }) => {
    const active = session(params.sessionId);
    active.cancelled = true;
    active.pending?.resolve();
  });
const connection = app.connect(
  ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin)),
);
await connection.closed;
