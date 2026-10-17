export const sessionKeys = {
  all: ['session'] as const,
  detail: (sessionId: string) => ['session', sessionId] as const,
  allReviews: ['session-review'] as const,
  allReviewFiles: ['session-review-file'] as const,
  reviewFiles: (sessionId: string) => ['session-review-file', sessionId] as const,
  review: (sessionId: string) => ['session-review', sessionId] as const,
  reviewFile: (sessionId: string, filePath: string, fromRevision?: string, toRevision?: string) =>
    ['session-review-file', sessionId, filePath, fromRevision, toRevision] as const,
  allBranches: ['session-branches'] as const,
  branches: (sessionId: string) => ['session-branches', sessionId] as const,
  allMergePreviews: ['session-merge-preview'] as const,
  mergePreview: (sessionId: string, targetBranch?: string) =>
    targetBranch
      ? (['session-merge-preview', sessionId, targetBranch] as const)
      : (['session-merge-preview', sessionId] as const),
  allGitStatuses: ['session-git-status'] as const,
  gitStatus: (sessionId: string) => ['session-git-status', sessionId] as const,
  execution: (sessionId: string) => ['session-execution', sessionId] as const,
  initialHistory: (sessionId: string) => ['session-initial-history', sessionId] as const,
  events: (sessionId: string | null) => ['events', sessionId] as const,
  turnIndex: (sessionId: string) => ['events', sessionId, 'turn-index'] as const,
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
  tools: ['mcpTools'] as const,
};
