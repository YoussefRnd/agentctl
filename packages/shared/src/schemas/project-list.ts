import { z } from 'zod';
import { sessionRowSchema } from './session-model.js';
export const projectListRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  path: z.string(),
  repoRoot: z.string().nullable(),
  subdir: z.string(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
  isGitRepo: z.boolean(),
  sessions: z.array(sessionRowSchema),
  lastActiveTime: z.number(),
});

export type ProjectListRow = z.infer<typeof projectListRowSchema>;

export type SidebarProject = Pick<ProjectListRow, 'id' | 'name' | 'path' | 'isGitRepo'> & {
  sessions: Pick<
    ProjectListRow['sessions'][number],
    | 'id'
    | 'title'
    | 'taskSlug'
    | 'branch'
    | 'status'
    | 'lastActivityAt'
    | 'updatedAt'
    | 'createdAt'
    | 'mode'
    | 'worktreePath'
    | 'hasUserActivity'
    | 'selectedProvider'
    | 'selectedModel'
    | 'pinnedAt'
    | 'settledAt'
    | 'lastReadEventId'
    | 'latestActivityEventId'
    | 'sidebarActivity'
  >[];
};
