export const sessionKeys = {
  all: ['session'] as const,
  detail: (sessionId: string) => ['session', sessionId] as const,
  allReviews: ['session-review'] as const,
  allReviewFiles: ['session-review-file'] as const,
  reviewFiles: (sessionId: string) => ['session-review-file', sessionId] as const,
  review: (sessionId: string) => ['session-review', sessionId] as const,
  reviewFile: (sessionId: string, filePath: string, fromHash?: string, toHash?: string) =>
    ['session-review-file', sessionId, filePath, fromHash, toHash] as const,
  allBranches: ['session-branches'] as const,
  branches: (sessionId: string) => ['session-branches', sessionId] as const,
  allGitStatuses: ['session-git-status'] as const,
  gitStatus: (sessionId: string) => ['session-git-status', sessionId] as const,
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
