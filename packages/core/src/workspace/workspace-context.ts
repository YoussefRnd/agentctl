import type { RepositoryService } from '../repository/repository-service.js';

/** Handoff context uses backend capabilities and never treats unavailable review as clean. */
export async function describeWorkspace(
  repositories: Pick<RepositoryService, 'open'>,
  directory: string,
): Promise<string> {
  const repository = await repositories.open(directory);
  const lines = [
    `Workspace: ${repository.info.workspacePath}`,
    `Repository backend: ${repository.info.backendId}`,
  ];
  const label = await repository.localLabel();
  if (label) lines.push(`Workspace label: ${label}`);
  if (!repository.info.capabilities.review)
    return [...lines, 'Workspace review is unavailable.'].join('\n');
  const review = await repository.review(undefined, { includeDiffs: false, scope: 'working' });
  lines.push(
    review.files.length
      ? `Workspace changes:\n${review.files.map((file) => `${file.state}: ${file.path}`).join('\n')}`
      : 'No workspace changes reported.',
  );
  return lines.join('\n\n');
}
