import { describe, expect, it } from 'vitest';
import type { SidebarProject } from '@agentctl/api-client';
import { findReusableDraftSession, shouldCreateHomeSession } from './HomeRoute';

describe('HomeRoute session lifecycle', () => {
  it('prepares a session as soon as a workspace is available', () => {
    expect(shouldCreateHomeSession(undefined, false)).toBe(false);
    expect(shouldCreateHomeSession('project-1', false)).toBe(true);
  });

  it('reuses an existing empty draft instead of creating another session', () => {
    const project = {
      sessions: [
        {
          id: 'active',
          title: 'Active session',
          status: 'running',
          hasUserActivity: true,
        },
        {
          id: 'draft',
          title: 'Mighty Wave',
          taskSlug: 'mighty-wave',
          status: 'idle',
          hasUserActivity: false,
        },
      ],
    } as unknown as SidebarProject;

    const draft = findReusableDraftSession(project);
    expect(draft?.id).toBe('draft');
    expect(shouldCreateHomeSession('project-1', !!draft)).toBe(false);
  });

  it('does not reuse a session after the user has started it', () => {
    const project = {
      sessions: [
        {
          id: 'started',
          title: 'New Session',
          taskSlug: 'mighty-wave',
          status: 'idle',
          hasUserActivity: true,
        },
      ],
    } as unknown as SidebarProject;

    expect(findReusableDraftSession(project)).toBeUndefined();
  });
});
