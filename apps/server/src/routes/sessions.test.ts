import { describe, expect, it, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from '@fastify/type-provider-zod';
import { sessionsRoutes } from './sessions.js';

const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  returning: vi.fn(),
  startSession: vi.fn(),
  restartSession: vi.fn(),
}));

vi.mock('@agentctl/core', () => ({
  db: {
    query: {
      projects: {
        findFirst: mocks.findFirst,
      },
      sessions: {
        findFirst: mocks.findFirst,
      },
    },
    insert: mocks.insert,
    update: mocks.update,
  },
  projects: {},
  sessions: {},
  listDriverCapabilities: () => [],
  resolveProviderSelection: (selection: { selectedDriver: string; selectedModel?: string; selectedThinkingEffort?: string }) => ({
    selectedDriver: selection.selectedDriver,
    selectedModel: selection.selectedModel ?? 'sonnet-4',
    selectedThinkingEffort: selection.selectedThinkingEffort ?? 'medium',
  }),
  getDriverCapability: (driver: string) => ({
    'claude-code': { driver: 'claude-code', label: 'Claude Code', command: 'claude', models: ['sonnet-4'], thinkingEfforts: ['low', 'medium', 'high'] },
    'gemini-cli': { driver: 'gemini-cli', label: 'Gemini CLI', command: 'gemini', models: ['gemini-2.5-pro'], thinkingEfforts: ['low', 'medium', 'high'] },
    opencode: { driver: 'opencode', label: 'OpenCode', command: 'opencode', models: ['default'], thinkingEfforts: ['low', 'medium', 'high'] },
    'codex-acp': { driver: 'codex-acp', label: 'Codex ACP', command: 'codex', models: ['default'], thinkingEfforts: ['low', 'medium', 'high'] },
  }[driver as 'claude-code' | 'gemini-cli' | 'opencode' | 'codex-acp'] ?? null),
}));

describe('sessionsRoutes', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mocks.findFirst.mockReset();
    mocks.insert.mockReset();
    mocks.update.mockReset();
    mocks.returning?.mockReset?.();
    mocks.restartSession.mockReset();
  });

  it('updates provider selection and restarts the session', async () => {
    const set = vi.fn().mockReturnThis();
    const where = vi.fn().mockReturnThis();
    const returning = vi.fn().mockResolvedValue([{
      id: '550e8400-e29b-41d4-a716-446655440000',
      projectId: '550e8400-e29b-41d4-a716-446655440001',
      branch: 'main',
      worktreePath: '/tmp/worktree',
      taskSlug: 'task',
      baseCommit: 'abc',
      agent: 'claude-code',
      agentSessionId: null,
      status: 'idle',
      totalTokens: 0,
      contextLimit: 128000,
      estimatedCost: 0,
      lastHeartbeat: null,
      closedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      selectedDriver: 'gemini-cli',
      selectedModel: 'gemini-2.5-pro',
      selectedThinkingEffort: 'high',
    }]);
    mocks.update.mockReturnValue({ set, where, returning });
    mocks.findFirst.mockResolvedValueOnce({
      id: '550e8400-e29b-41d4-a716-446655440000',
      projectId: '550e8400-e29b-41d4-a716-446655440001',
      branch: 'main',
      worktreePath: '/tmp/worktree',
      taskSlug: 'task',
      baseCommit: 'abc',
      agent: 'claude-code',
      agentSessionId: null,
      status: 'idle',
      totalTokens: 0,
      contextLimit: 128000,
      estimatedCost: 0,
      lastHeartbeat: null,
      closedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      selectedDriver: 'claude-code',
      selectedModel: 'sonnet-4',
      selectedThinkingEffort: 'medium',
    });

    const app = Fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    app.decorate('sessionManager', {
      restartSession: mocks.restartSession,
      startSession: vi.fn(),
      handleClientMessage: vi.fn(),
      runners: new Map(),
      fastify: app,
    } as never);
    await app.register(sessionsRoutes, { prefix: '/api' });

    const response = await app.inject({
      method: 'PATCH',
      url: '/api/sessions/550e8400-e29b-41d4-a716-446655440000/provider',
      payload: {
        selectedDriver: 'gemini-cli',
        selectedModel: 'gemini-2.5-pro',
        selectedThinkingEffort: 'high',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(mocks.restartSession).toHaveBeenCalledWith('550e8400-e29b-41d4-a716-446655440000', '/tmp/worktree', {
      selectedDriver: 'gemini-cli',
      selectedModel: 'gemini-2.5-pro',
      selectedThinkingEffort: 'high',
    });
    expect(set).toHaveBeenCalled();
    expect(where).toHaveBeenCalled();
    expect(returning).toHaveBeenCalled();
  });

  it('starts a new session with the resolved provider command', async () => {
    vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue('550e8400-e29b-41d4-a716-446655440000');

    const project = {
      id: '550e8400-e29b-41d4-a716-446655440001',
      name: 'Project',
      path: '/tmp/project',
    };
    const createdSession = {
      id: '550e8400-e29b-41d4-a716-446655440000',
      projectId: project.id,
      branch: 'agent/task',
      worktreePath: '/tmp/project/.agentctl/worktrees/task',
      taskSlug: 'task',
      baseCommit: 'HEAD',
      agent: 'gemini-cli',
      agentSessionId: null,
      status: 'idle',
      totalTokens: 0,
      contextLimit: 128000,
      estimatedCost: 0,
      lastHeartbeat: null,
      closedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      selectedDriver: 'gemini-cli',
      selectedModel: 'gemini-2.5-pro',
      selectedThinkingEffort: 'low',
    };

    mocks.findFirst.mockResolvedValueOnce(project);
    mocks.insert.mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([createdSession]),
      }),
    });

    const app = Fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    app.decorate('sessionManager', {
      restartSession: mocks.restartSession,
      startSession: mocks.startSession,
      handleClientMessage: vi.fn(),
      runners: new Map(),
      fastify: app,
    } as never);
    await app.register(sessionsRoutes, { prefix: '/api' });

    const response = await app.inject({
      method: 'POST',
      url: '/api/sessions',
      payload: {
        projectId: project.id,
        agent: 'gemini-cli',
        taskSlug: 'task',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(mocks.startSession).toHaveBeenCalledWith(
      '550e8400-e29b-41d4-a716-446655440000',
      '/tmp/project/.agentctl/worktrees/task',
      'gemini',
      ['gemini-2.5-pro', 'low'],
    );
  });
});
