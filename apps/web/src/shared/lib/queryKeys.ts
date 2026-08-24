export const sessionKeys = {
  all: ['session'] as const,
  detail: (sessionId: string) => ['session', sessionId] as const,
  review: (sessionId: string) => ['session-review', sessionId] as const,
  branches: (sessionId: string) => ['session-branches', sessionId] as const,
  events: (sessionId: string) => ['events', sessionId] as const,
};

export const providerKeys = {
  all: ['providers'] as const,
  registry: ['registry'] as const,
};

export const projectKeys = {
  all: ['projects'] as const,
  detail: (projectId: string) => ['projects', projectId] as const,
};

export const settingsKeys = {
  all: ['settings'] as const,
};

export const mcpKeys = {
  all: ['mcp-servers'] as const,
};
