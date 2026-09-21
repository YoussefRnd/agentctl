import { describe, expect, it } from 'vitest';
import type { SidebarProject } from '@agentctl/api-client';
import { findReusableDraftSession, shouldCreateHomeSession } from './HomeRoute';

describe('HomeRoute session lifecycle', () => {
  it('does not create a session until the user explicitly starts one', () => {
    expect(shouldCreateHomeSession('project-1', false, null)).toBe(false);
    expect(shouldCreateHomeSession('project-1', false, { projectId: 'project-2' })).toBe(false);
    expect(shouldCreateHomeSession('project-1', false, { projectId: 'project-1' })).toBe(true);
  });

  it('reuses an existing empty draft instead of creating another session', () => {
    const project = {
      sessions: [
        { id: 'active', title: 'Active session', status: 'running', lastActivityAt: new Date() },
        { id: 'draft', title: 'New Session', status: 'idle', lastActivityAt: null },
      ],
    } as unknown as SidebarProject;

    const draft = findReusableDraftSession(project);
    expect(draft?.id).toBe('draft');
    expect(shouldCreateHomeSession('project-1', !!draft, { projectId: 'project-1' })).toBe(false);
  });
});
