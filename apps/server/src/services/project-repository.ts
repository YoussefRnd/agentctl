import { eq } from 'drizzle-orm';
import { projects, type DbClient } from '@agentctl/core/db';
import type { GitRepositoryAccess } from '@agentctl/core/git';

/** Projects can gain a Git repository after being opened or upgrading an older database. */
export async function refreshProjectRepository(
  db: DbClient,
  manager: Pick<GitRepositoryAccess, 'resolveRepository'>,
  project: typeof projects.$inferSelect,
): Promise<typeof projects.$inferSelect> {
  if (project.repoRoot) return project;
  const repository = await manager.resolveRepository(project.path);
  if (!repository.isGitRepo || !repository.repoRoot) return project;
  const [updated] = await db
    .update(projects)
    .set({ repoRoot: repository.repoRoot, subdir: repository.workdirPrefix })
    .where(eq(projects.id, project.id))
    .returning();
  return updated;
}
