# Applying agent-scale source control ideas to AgentCtl

Reviewed October 16, 2026, against the current Git, snapshot, review, and session code.

This is the original dated design assessment. The implemented repository/workspace boundary
and backend extension scope are documented in [Repository architecture](repository-architecture.md).

Anthropic's [Redesigning source control at Anthropic](https://www.anthropic.com/engineering/redesigning-source-control)
describes Scion, a system built for a huge, centralized monorepo with predominantly online
clients. Its transferable ideas include keeping shared coordination small, deriving results
from immutable data, and avoiding unnecessary working copies and file materialization.
Anthropic explicitly limits the suitability of its architecture to unusually large workloads.

The recommendations below are an assessment of AgentCtl's implementation. They do not assume
that AgentCtl has Anthropic's workload or would achieve its reported performance gains.

## Keep Git and the local-first model

AgentCtl runs providers against real project directories and isolates sessions with Git
worktrees. Those worktrees already share Git's object database. A source control server or a
new repository format would introduce a deployment dependency and require replacing existing
review, recovery, branch, and pull-request integrations. The current code provides no evidence
that such a migration is justified.

Keep the current merge readiness checks, expected-old-commit updates, and recovery behavior.
Their invariants are documented in [Git workflow review](git-workflow-review.md). Higher
concurrency is a reason to test these boundaries more thoroughly, not to remove them.

## First improvement: release snapshot locks before deriving results

`packages/core/src/git/snapshot-service.ts` uses a private Git index for captures and a
per-project mutex to protect that index and restore operations. Before this change,
`getReview` held the mutex through tree comparisons and patch formatting. Turn comparisons
also held it while calculating statistics. A slow review therefore delayed subsequent
captures in that workspace.

The implementation now:

1. Captures the current tree, baseline trees, and review status while holding the mutex.
2. Releases the mutex before calculating statistics or formatting patches from those trees.
3. Builds the response entirely from captured values, so a later capture, staging change,
   or commit does not change the response in progress.

`getCheckpointDiffFiles` already used this pattern. Restore operations continue to hold their
lock through validation, application, and rollback. The change adds no persistent cache,
dependency, API field, or provider requirement.

Regression tests pause statistics and patch formatting, complete a later capture before
resuming them, and check that the earlier response still describes the earlier content.
They verify concurrency and consistency; they are not a latency benchmark. The mutex is
internal to one service instance and does not synchronize external Git clients or arbitrary
filesystem writers. Capturing status and trees is not an atomic filesystem transaction.

Validation: 162 tests passed across the Git package, session Git API, and parallel-agent API.
The core/shared build, core typecheck, scoped lint, formatting, and diff whitespace checks
also passed. The new tests include pinning a tree ref before it moves during a comparison.

## Next priorities

| Priority | Current observation                                                                                                           | Proposed work                                                                                                                                                                             | Evidence needed before expanding it                                                                                                                           |
| -------- | ----------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1        | `WorkspaceManager` serializes many operations using the repository path, including review wrappers and network operations.    | Measure queue wait and execution time separately. Identify worktree-local operations that can safely overlap; preserve coordination for branch/worktree lifecycle and merge destinations. | Real workloads with multiple sessions; tests for shared refs, cancellation, cleanup, and merges touching another checkout.                                    |
| 2        | Review summaries omit patches, and file details can use captured tree IDs. Repeated requests still calculate derived results. | If repeated comparisons are material, add bounded reuse keyed by repository identity, resolved tree IDs, and literal file path. Keep mutable status fresh.                                | Git subprocess counts, cache hit rate, retained bytes, error retry behavior, and eviction tests. Never key historical results solely by a moving branch name. |
| 3        | Worktree creation materializes a normal checkout, and providers expect files on disk.                                         | Measure checkout time and disk use on large projects. Consider opt-in sparse worktrees with explicit project/dependency paths if those costs dominate.                                    | Provider compatibility, builds needing sibling packages, ignored setup files, snapshots, review scope, and restore behavior.                                  |

## How to measure the next change

Use disposable repositories with representative file counts and histories. Run the same
workload with one session and with several concurrent sessions. Record Git command counts,
capture and review latency distributions, lock queue time, and peak memory/disk use. Separate
summary requests from file-detail requests and cold runs from warm runs.

Include both multiple requests in one workspace and separate worktrees sharing a repository:
the snapshot mutex and repository mutex have different scopes. Pause expensive reads and
network operations in deterministic tests to establish whether unrelated work can proceed.
Keep timing measurements separate from correctness assertions, and only claim improvements
supported by comparable before/after runs.

The next useful investment is visibility into repository lock contention. Its results should
determine whether finer lock scopes, derived-result caching, or sparse checkout deserves the
next implementation effort.
