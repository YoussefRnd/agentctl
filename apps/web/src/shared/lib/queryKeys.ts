export const sessionKeys = {
  all: ['session'] as const,
  detail: (sessionId: string) => ['session', sessionId] as const,
  allReviewChecks: ['review-checks'] as const,
  reviewChecks: (id: string, reviewId?: string) =>
    reviewId ? (['review-checks', id, reviewId] as const) : (['review-checks', id] as const),
  reviewCheck: (id: string, reviewId: string, checkId: string) =>
    ['review-check-output', id, reviewId, checkId] as const,
  codeReviewFile: (sessionId: string, reviewId: string, path: string) =>
    ['code-review-file', sessionId, reviewId, path] as const,
  allCodeReviews: ['session-code-reviews'] as const,
  codeReviews: (sessionId: string) => ['session-code-reviews', sessionId] as const,
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
  list: (sortBy: string, gitOnly: boolean) => ['projects', 'list', sortBy, gitOnly] as const,
};

export const settingsKeys = {
  all: ['settings'] as const,
};

export const mcpKeys = {
  all: ['mcp-servers'] as const,
  tools: ['mcpTools'] as const,
};
