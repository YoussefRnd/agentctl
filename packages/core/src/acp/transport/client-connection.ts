import {
  AcpSubagentSessions,
  isSubagentNotification,
  type SubagentNotification,
} from '../protocol/subagent-sessions.js';
import { withSessionSetupTracking } from './subagent-stream.js';
import { AcpRequestScopes, SESSION_REQUEST_METHODS } from '../protocol/request-scopes.js';
import { wrapDebug } from './stream-debug.js';
import type { ClientSessionContext } from '../protocol/client-handlers.js';
import { ACP_MAX_PENDING_UPDATES } from './limits.js';
import {
  client,
  methods,
  type ClientSideConnection,
  type ClientConnection,
  type Stream,
  type SessionNotification,
} from '@agentclientprotocol/sdk';
import { createClientHandlers, type ClientHandlerContext } from '../protocol/client-handlers.js';

/** The outbound ACP operations used by the v1 driver, independent of SDK wrapper classes. */
export type AcpAgentConnection = Pick<
  ClientSideConnection,
  | 'initialize'
  | 'newSession'
  | 'loadSession'
  | 'unstable_forkSession'
  | 'listSessions'
  | 'deleteSession'
  | 'resumeSession'
  | 'closeSession'
  | 'setSessionMode'
  | 'setSessionConfigOption'
  | 'authenticate'
  | 'logout'
  | 'prompt'
  | 'cancel'
  | 'request'
  | 'notify'
  | 'extMethod'
  | 'extNotification'
  | 'closed'
  | 'signal'
> & {
  close?(): void;
  resolveSessionContext?(sessionId: string): ClientSessionContext;
  flushPendingSessionUpdates?(): Promise<void>;
};

/** Register with the app API so individual requests retain their cancellation context. */
export async function connectAcpClient(
  context: ClientHandlerContext,
  stream: Stream,
): Promise<AcpAgentConnection> {
  const subagents = new AcpSubagentSessions<ClientSessionContext>((id) =>
    context.resolveSession({ sessionId: id }),
  );
  const resolveSession = (params?: { sessionId?: string; requestId?: string | number }) =>
    params?.sessionId ? subagents.resolve(params.sessionId) : context.resolveSession(params);
  const pendingRoots = new Map<string, string>();
  const rootFor = (id: string) => pendingRoots.get(id) ?? subagents.rootSessionId(id);
  const pending: Array<{
    notification: SessionNotification | SubagentNotification;
    draft: boolean;
    historical: boolean;
  }> = [];
  const canResolve = (id: string) => {
    try {
      subagents.resolve(id);
      return true;
    } catch {
      return false;
    }
  };
  const queuePending = (
    notification: SessionNotification | SubagentNotification,
    draft: boolean,
    historical: boolean,
  ) => {
    if (pending.length >= ACP_MAX_PENDING_UPDATES)
      throw new Error('Too many ACP updates before session setup');
    pending.push({ notification, draft, historical });
  };
  let flushing: Promise<void> | undefined;
  const flushPendingSessionUpdates = () =>
    (flushing ??= (async () => {
      const snapshot = pending.splice(0);
      for (const item of snapshot) {
        if (!canResolve(item.notification.sessionId)) {
          pending.push(item);
          continue;
        }
        if (item.draft)
          await subagents.update(item.notification as SubagentNotification, item.historical);
        else await handlers.sessionUpdate(item.notification as SessionNotification);
      }
    })().finally(() => {
      flushing = undefined;
    }));
  const scopes = new AcpRequestScopes<ClientSessionContext>((method, params) => {
    if (!SESSION_REQUEST_METHODS.has(method)) return undefined;
    try {
      return resolveSession({
        sessionId: typeof params.sessionId === 'string' ? params.sessionId : undefined,
      });
    } catch {
      return undefined;
    }
  });
  const handlers = createClientHandlers({
    ...context,
    resolveSession(params) {
      if (params?.requestId !== undefined && !params.sessionId) {
        const scope = scopes.get(params.requestId);
        if (!scope) throw new Error('Elicitation request scope is no longer active');
        return scope;
      }
      return resolveSession(params);
    },
  });
  const app = client({ name: 'agentctl' })
    .onRequest(methods.client.session.requestPermission, ({ params, signal }) =>
      handlers.requestPermission(params, signal),
    )
    .onNotification(methods.client.session.update, async ({ params }) => {
      if (pending.length && canResolve(params.sessionId)) await flushPendingSessionUpdates();
      if (isSubagentNotification(params)) {
        const historical = adapted.isHistorical(rootFor(params.sessionId));
        if (params.update.sessionUpdate === 'subagent_update')
          pendingRoots.set(params.update.sessionId, rootFor(params.sessionId));
        if (!canResolve(params.sessionId)) {
          queuePending(params, true, historical);
          return;
        }
        return subagents.update(params, historical);
      }
      if (!canResolve(params.sessionId)) {
        queuePending(params, false, adapted.isHistorical(rootFor(params.sessionId)));
        return;
      }
      return handlers.sessionUpdate(params);
    })
    .onRequest(methods.client.fs.readTextFile, ({ params }) => handlers.readTextFile!(params))
    .onRequest(methods.client.fs.writeTextFile, ({ params, signal }) =>
      handlers.writeTextFile!(params, signal),
    )
    .onRequest(methods.client.terminal.create, ({ params, signal }) =>
      handlers.createTerminal!(params, signal),
    )
    .onRequest(methods.client.terminal.output, ({ params }) => handlers.terminalOutput!(params))
    .onRequest(methods.client.terminal.release, ({ params }) => handlers.releaseTerminal!(params))
    .onRequest(methods.client.terminal.waitForExit, ({ params, signal }) =>
      handlers.waitForTerminalExit!(params, signal),
    )
    .onRequest(methods.client.terminal.kill, ({ params }) => handlers.killTerminal!(params))
    .onRequest(methods.client.elicitation.create, ({ params, signal }) =>
      handlers.createElicitation(params, signal),
    )
    .onNotification(methods.client.elicitation.complete, ({ params }) =>
      handlers.completeElicitation!(params),
    );

  const extensions = [
    '_agentctl.dev/builtin/bash',
    '_agentctl.dev/terminal/create',
    '_agentctl.dev/terminal/write',
    ...((await context.mcpGateway?.getTools()) ?? []).map(
      (tool) => `_agentctl.dev/mcp/${tool.name}`,
    ),
  ];
  for (const method of extensions) {
    app.onRequest(
      method,
      (params: unknown) => params as Record<string, unknown>,
      ({ params, signal }) => handlers.extMethod!(method, params, signal),
    );
  }
  app.onNotification(
    '_agentctl.dev/session/update',
    (params: unknown) => params as Record<string, unknown>,
    ({ params }) => handlers.extNotification!('_agentctl.dev/session/update', params),
  );

  const adapted = withSessionSetupTracking(stream, {
    onRootSession: context.onRootSession,
    onError: (error) => context.logger.warn(error, 'Invalid ACP subagent update'),
  });
  const connection = app.connect(
    wrapDebug(adapted, (direction, frame) => scopes.observe(direction, frame)),
  );
  void connection.closed
    .finally(() => {
      scopes.clear();
      subagents.clear();
      pending.length = 0;
      pendingRoots.clear();
    })
    .catch(() => undefined);
  return {
    ...agentConnectionFacade(connection),
    flushPendingSessionUpdates,
    resolveSessionContext: (id) => subagents.resolve(id),
  };
}

/** Keep the driver surface identical for session and restricted control connections. */
export function agentConnectionFacade(connection: ClientConnection): AcpAgentConnection {
  const agent = connection.agent;
  return {
    initialize: (params) => agent.request(methods.agent.initialize, params),
    newSession: (params) => agent.request(methods.agent.session.new, params),
    loadSession: (params) => agent.request(methods.agent.session.load, params),
    unstable_forkSession: (params) => agent.request(methods.agent.session.fork, params),
    listSessions: (params) => agent.request(methods.agent.session.list, params),
    deleteSession: (params) => agent.request(methods.agent.session.delete, params),
    resumeSession: (params) => agent.request(methods.agent.session.resume, params),
    closeSession: (params) => agent.request(methods.agent.session.close, params),
    setSessionMode: (params) => agent.request(methods.agent.session.setMode, params),
    setSessionConfigOption: (params) =>
      agent.request(methods.agent.session.setConfigOption, params),
    authenticate: (params) => agent.request(methods.agent.authenticate, params),
    logout: (params) => agent.request(methods.agent.logout, params),
    prompt: (params) => agent.request(methods.agent.session.prompt, params),
    cancel: (params) => agent.notify(methods.agent.session.cancel, params),
    request: agent.request.bind(agent),
    notify: agent.notify.bind(agent),
    extMethod: (method, params) => agent.request(method, params),
    extNotification: (method, params) => agent.notify(method, params),
    close: () => connection.close(),
    closed: connection.closed,
    signal: connection.signal,
  };
}
