import { describe, expect, it, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from '@fastify/type-provider-zod';
import { projectsRoutes } from './projects.js';

const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
  values: vi.fn(),
  from: vi.fn(),
}));

vi.mock('@agentctl/core', () => ({
  db: {
    query: {
      projects: {
        findFirst: mocks.findFirst,
      },
    },
    insert: () => ({
      values: mocks.values,
    }),
    select: () => ({
      from: mocks.from,
    }),
  },
  projects: {},
  sessions: {},
  resolveProviderSelection: (selection: { selectedDriver: string }) => ({
    selectedDriver: selection.selectedDriver,
    selectedModel: 'sonnet-4',
    selectedThinkingEffort: 'medium',
  }),
  getDriverCapability: (driver: string) => {
    const caps: Record<string, { driver: string; command: string; models: string[]; thinkingEfforts: string[] }> = {
      'claude-code': { driver: 'claude-code', command: 'claude', models: ['sonnet-4'], thinkingEfforts: ['low', 'medium', 'high'] },
      'gemini-cli': { driver: 'gemini-cli', command: 'gemini', models: ['gemini-2.5-pro'], thinkingEfforts: ['low', 'medium', 'high'] },
      opencode: { driver: 'opencode', command: 'opencode', models: ['default'], thinkingEfforts: ['low', 'medium', 'high'] },
      'codex-acp': { driver: 'codex-acp', command: 'codex', models: ['default'], thinkingEfforts: ['low', 'medium', 'high'] },
    };
    return caps[driver] ?? null;
  },
}));

describe('projectsRoutes', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mocks.findFirst.mockReset();
    mocks.from.mockReset();
    mocks.values.mockReset();
  });

  it('creates a project and first session from a folder path', async () => {
    vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue('550e8400-e29b-41d4-a716-446655440000');

    const projectReturning = vi.fn().mockResolvedValue([{
      id: '550e8400-e29b-41d4-a716-446655440001',
      name: 'myproject',
      path: '/home/user/myproject',
    }]);
    const sessionReturning = vi.fn().mockResolvedValue([{
      id: '550e8400-e29b-41d4-a716-446655440002',
      projectId: '550e8400-e29b-41d4-a716-446655440001',
      title: 'new session',
      taskSlug: 'new-session',
      branch: 'agent/new-session',
      worktreePath: '/home/user/myproject/.agentctl/worktrees/new-session',
      baseCommit: 'HEAD',
      agent: 'claude-code',
      selectedDriver: 'claude-code',
      selectedModel: 'sonnet-4',
      selectedThinkingEffort: 'medium',
      status: 'idle',
      totalTokens: 0,
      contextLimit: 128000,
      estimatedCost: 0,
      lastHeartbeat: null,
      closedAt: null,
    }]);

    mocks.values
      .mockReturnValueOnce({ returning: projectReturning })
      .mockReturnValueOnce({ returning: sessionReturning });

    const app = Fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    app.decorate('sessionManager', {
      startSession: vi.fn(),
      restartSession: vi.fn(),
      handleClientMessage: vi.fn(),
      runners: new Map(),
      fastify: app,
    } as never);
    await app.register(projectsRoutes, { prefix: '/api' });

    const response = await app.inject({
      method: 'POST',
      url: '/api/projects',
      payload: {
        path: '/home/user/myproject',
        selectedDriver: 'claude-code',
      },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { project: { name: string }; sessionId: string };
    expect(body.project.name).toBe('myproject');
    expect(body.sessionId).toBe('550e8400-e29b-41d4-a716-446655440002');
  });
});
