import { describe, it, expect } from 'vitest';
import {
  extractTurnChanges,
  extractFilePathFromToolCall,
  extractLatestTurnTouchedFiles,
  filePathMatches,
  resolveTurnReviewFiles,
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
    expect(
      extractFilePathFromToolCall({
        arguments: { AbsolutePath: '/home/user/packages/core/src/feature.ts' },
      }),
    ).toBe('home/user/packages/core/src/feature.ts');
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
    expect(touched.size).toBe(1);
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
    expect(
      touched.has('home/youssef/.agentctl/worktrees/agentctl/slot-1/packages/core/src/feature.ts'),
    ).toBe(true);

    const summary = extractTurnChanges(mockEvents);
    expect(summary.files.length).toBe(1);
    expect(summary.files[0].path).toBe(
      'home/youssef/.agentctl/worktrees/agentctl/slot-1/packages/core/src/feature.ts',
    );
  });

  it('ignores read-only tool calls when finding files touched in the latest turn', () => {
    const mockEvents: ACPEventRow[] = [
      {
        id: 1,
        sessionId: 's1',
        type: 'tool_call',
        data: {
          name: 'read_file',
          kind: 'read',
          arguments: { path: 'src/unchanged.ts' },
        },
        createdAt: new Date(),
      },
    ];

    expect(extractLatestTurnTouchedFiles(mockEvents).size).toBe(0);
  });

  it('does not select multiple review files from an ambiguous basename', () => {
    const reviewFiles: ReviewFile[] = [
      { path: 'apps/web/src/index.ts', state: 'modified', diff: '' },
      { path: 'packages/core/src/index.ts', state: 'modified', diff: '' },
      { path: 'packages/core/src/feature.ts', state: 'modified', diff: '' },
    ];

    expect(resolveTurnReviewFiles(reviewFiles, ['index.ts'])).toEqual(new Set());
    expect(resolveTurnReviewFiles(reviewFiles, ['core/src/index.ts'])).toEqual(
      new Set(['packages/core/src/index.ts']),
    );
    expect(resolveTurnReviewFiles(reviewFiles, ['feature.ts'])).toEqual(
      new Set(['packages/core/src/feature.ts']),
    );
  });

  it('uses turn-local tool diffs instead of cumulative review stats', () => {
    const events: ACPEventRow[] = [
      {
        id: 1,
        sessionId: 's1',
        type: 'tool_call',
        data: {
          name: 'edit_file',
          kind: 'edit',
          arguments: { path: 'src/feature.ts' },
          content: [{ type: 'diff', oldText: 'old line', newText: 'new line\nextra line' }],
        },
        createdAt: new Date(),
      },
    ];
    const reviewFiles: ReviewFile[] = [
      {
        path: 'src/feature.ts',
        state: 'modified',
        diff: '@@ -1,10 +1,20 @@\n-old 1\n-old 2\n+new 1\n+new 2\n+new 3',
      },
    ];

    expect(extractTurnChanges(events, reviewFiles)).toMatchObject({
      totalAdditions: 2,
      totalDeletions: 1,
      files: [{ path: 'src/feature.ts', additions: 2, deletions: 1 }],
    });
  });

  it('never treats shell commands or searches as file modifications', () => {
    const mockEvents: ACPEventRow[] = [
      {
        id: 1,
        sessionId: 's1',
        type: 'tool_call',
        data: {
          name: 'run_command',
          kind: 'execute',
          title: 'Update test suite',
          arguments: {
            CommandLine: "rg -n 'plan_update|plan' packages/core/src/acp/protocol/events.ts | head",
          },
        },
        createdAt: new Date(),
      },
      {
        id: 2,
        sessionId: 's1',
        type: 'tool_call',
        data: {
          name: 'run_command',
          kind: 'execute',
          title: 'Delete temp files',
          arguments: {
            CommandLine: 'rm -f packages/core/src/random-a.test.ts && echo "done"',
          },
        },
        createdAt: new Date(),
      },
    ];

    const summary = extractTurnChanges(mockEvents);
    expect(summary.files).toEqual([]);
    expect(summary.totalAdditions).toBe(0);
    expect(summary.totalDeletions).toBe(0);
  });

  it('prioritizes server-provided turnChanges from turn_end status event', () => {
    const serverTurnChanges = {
      files: [
        { path: 'src/feature.ts', additions: 15, deletions: 2, status: 'modified' as const },
        { path: 'src/new-file.ts', additions: 42, deletions: 0, status: 'added' as const },
      ],
      totalAdditions: 57,
      totalDeletions: 2,
    };

    const mockEvents: ACPEventRow[] = [
      {
        id: 1,
        sessionId: 's1',
        type: 'tool_call',
        data: {
          name: 'write_to_file',
          kind: 'edit',
          arguments: { TargetFile: 'src/feature.ts' },
        },
        createdAt: new Date(),
      },
      {
        id: 2,
        sessionId: 's1',
        type: 'status',
        data: {
          status: 'turn_end',
          stopReason: 'end_turn',
          turnChanges: serverTurnChanges,
        },
        createdAt: new Date(),
      },
    ];

    const summary = extractTurnChanges(mockEvents);
    expect(summary).toEqual(serverTurnChanges);
  });
});
