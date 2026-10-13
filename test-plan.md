# Random Test Plan: Dueling Agents Bake-Off

**Goal:** Test whether harness + model choice actually changes output quality on the same tasks.
**Date:** Oct 3, 2026 · **Owner:** you

## Setup
1. Pick 3 small, well-defined tasks (e.g. fix a bug, add a feature, write tests for a module)
2. Snapshot the repo to a clean branch per agent so runs don't contaminate each other
3. Agents under test:
   - Codex with `gpt-6-sol` (high effort)
   - Claude Code with Opus 5.5 (default)
   - OpenCode with any cheap open-weight model (baseline)

## Metrics
| Metric | How to capture |
| --- | --- |
| Time to done | elapsed time per run |
| Tokens / cost | usage logs per agent |
| Correctness | do the tests pass? |
| Mergeability | scope discipline, no unrelated cleanup, follows repo conventions |
| Collaboration style | clarity, verbosity, what it did/didn't check |

## Run
- [ ] Task 1: bug fix — all 3 agents, same prompt, fresh branch each
- [ ] Task 2: feature — same, plus a steering message mid-run (test if it stays oriented)
- [ ] Task 3: test-writing — same, compare test quality and file placement

## Scoring
Rank each agent 1–3 per metric per task, weighted: correctness 2x, everything else 1x.

## Decision rule
- Cross-review: have each agent review the others' diffs — a model reviewing its own family's output repeats its blind spots
- Winner = highest weighted average; ties go to lower cost per task

## Cleanup
Delete branches, archive usage logs, note anything weird for the next bake-off.
