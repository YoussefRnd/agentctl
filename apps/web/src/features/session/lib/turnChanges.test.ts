import { describe, it, expect } from 'vitest';
import {
  extractTurnChanges,
  extractFilePathFromToolCall,
  extractLatestTurnTouchedFiles,
  filePathMatches,
} from './turnChanges';
import type { ACPEventRow } from '@agentctl/shared';
import type { ReviewFile } from '../components/ReviewHeader';

describe('turnChanges', () => {
  it('extracts file path from various tool call argument structures', () => {
    expect(extractFilePathFromToolCall({ arguments: { targetFile: '/src/App.tsx' } })).toBe(
      'src/App.tsx',
    );
    expect(extractFilePathFromToolCall({ arguments: { path: './packages/core/index.ts' } })).toBe(
      'packages/core/index.ts',
    );
    expect(extractFilePathFromToolCall({ locations: [{ path: 'apps/web/src/main.tsx' }] })).toBe(
      'apps/web/src/main.tsx',
    );
    expect(extractFilePathFromToolCall({ title: 'Create packages/core/src/feature.ts' })).toBe(
      'packages/core/src/feature.ts',
    );
  });

  it('matches paths across absolute and relative forms', () => {
    expect(
      filePathMatches(
        'packages/core/src/feature.ts',
        '/home/user/agentctl/packages/core/src/feature.ts',
      ),
    ).toBe(true);
    expect(filePathMatches('packages/core/src/feature.ts', 'feature.ts')).toBe(true);
    expect(filePathMatches('packages/core/src/feature.ts', 'package.json')).toBe(false);
  });

  it('summarizes file modifications and calculates diff stats from review files', () => {
    const mockEvents: ACPEventRow[] = [
      {
        id: 1,
        sessionId: 's1',
        type: 'tool_call',
        data: {
          name: 'write_to_file',
          kind: 'edit',
          arguments: { TargetFile: '/home/user/agentctl/packages/core/src/feature.ts' },
        },
        createdAt: new Date(),
      },
      {
        id: 2,
        sessionId: 's1',
        type: 'tool_call',
        data: {
          name: 'replace_file_content',
          kind: 'edit',
          arguments: { targetFile: 'package.json' },
        },
        createdAt: new Date(),
      },
    ];

    const mockReviewFiles: ReviewFile[] = [
      {
        path: 'packages/core/src/feature.ts',
        state: 'untracked',
        diff: 'diff --git a/feature.ts b/feature.ts\n@@ -0,0 +1,5 @@\n+line1\n+line2\n+line3\n+line4\n+line5',
      },
      {
        path: 'package.json',
        state: 'modified',
        diff: 'diff --git a/package.json b/package.json\n@@ -1,3 +1,3 @@\n-old\n+new',
      },
    ];

    const summary = extractTurnChanges(mockEvents, mockReviewFiles);
    expect(summary.files.length).toBe(2);
    expect(summary.totalAdditions).toBe(6); // 5 + 1
    expect(summary.totalDeletions).toBe(1); // 0 + 1
  });

  it('extracts latest turn touched files from event stream', () => {
    const mockEvents: ACPEventRow[] = [
      {
        id: 1,
        sessionId: 's1',
        type: 'text',
        data: { role: 'user', content: 'Create feature' },
        createdAt: new Date(),
      },
      {
        id: 2,
        sessionId: 's1',
        type: 'tool_call',
        data: {
          name: 'write_to_file',
          kind: 'edit',
          arguments: { TargetFile: 'packages/core/src/feature.ts' },
        },
        createdAt: new Date(),
      },
    ];

    const touched = extractLatestTurnTouchedFiles(mockEvents);
    expect(touched.has('packages/core/src/feature.ts')).toBe(true);
    expect(touched.has('feature.ts')).toBe(true);
  });

  it('detects file creation when tool name is the file path and rawOutput is Wrote file successfully', () => {
    const mockEvents: ACPEventRow[] = [
      {
        id: 1921,
        sessionId: 's1',
        type: 'tool_call',
        data: {
          name: 'packages/core/src/feature.ts',
          arguments: {},
          title: 'packages/core/src/feature.ts',
          status: 'completed',
          content: [
            { content: { text: 'Wrote file successfully.', type: 'text' }, type: 'content' },
          ],
          rawOutput: {
            output: 'Wrote file successfully.',
            metadata: {
              filepath:
                '/home/youssef/.agentctl/worktrees/agentctl/slot-1/packages/core/src/feature.ts',
              exists: false,
            },
          },
        },
        createdAt: new Date(),
      },
    ];

    const touched = extractLatestTurnTouchedFiles(mockEvents);
    expect(touched.has('packages/core/src/feature.ts')).toBe(true);
    expect(touched.has('feature.ts')).toBe(true);

    const summary = extractTurnChanges(mockEvents);
    expect(summary.files.length).toBe(1);
    expect(summary.files[0].path).toBe(
      'home/youssef/.agentctl/worktrees/agentctl/slot-1/packages/core/src/feature.ts',
    );
  });
});
